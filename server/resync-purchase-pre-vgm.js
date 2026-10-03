/**
 * 批量：請購申請「尚未簽到副總經理」的簽核中單據
 * 依目前流程定義 + 申請表單資料重算 steps_snapshot，套用最新副總條件（含非必填／簽核人名單）。
 *
 * 用法：
 *   node server/resync-purchase-pre-vgm.js           # 預覽（dry-run）
 *   node server/resync-purchase-pre-vgm.js --apply   # 實際寫入
 *
 * 安全規則：
 * - 僅 workflow 名稱含「請購」且 status=pending
 * - 簽核歷程中尚無「副總」相關核准
 * - 已核准過的步驟（依步驟名稱）保留原快照簽核人；其後步驟改用新解析結果
 */
const path = require('path');

// 優先 node:sqlite（Docker Node 22）；本機若用 better-sqlite3 亦可
let db;
try {
  const { DatabaseSync } = require('node:sqlite');
  const dbPath = path.join(__dirname, '..', 'data', 'approval.db');
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON');
} catch {
  db = require('./db');
}

const APPLY = process.argv.includes('--apply');

const ASSIGN_TYPES = [
  'users',
  'form_user',
  'dept_head',
  'department',
  'users_pick',
  'cosign_pick',
];

function parseSteps(json) {
  try {
    const steps = typeof json === 'string' ? JSON.parse(json) : json;
    if (!Array.isArray(steps) || !steps.length) return null;
    return steps.map((s, i) => {
      const assignType = ASSIGN_TYPES.includes(s.assignType) ? s.assignType : 'users';
      let approverFields = [];
      try {
        const raw = s.approverFields || s.approver_fields || [];
        approverFields = Array.isArray(raw) ? raw : [];
      } catch {
        approverFields = [];
      }
      return {
        order: i + 1,
        name: String(s.name || `步驟 ${i + 1}`).trim(),
        assignType,
        formFieldId: s.formFieldId ? String(s.formFieldId).trim().slice(0, 40) : 'agent',
        department: s.department ? String(s.department).trim() : '',
        approverIds: Array.isArray(s.approverIds)
          ? s.approverIds.map(Number).filter(Boolean)
          : [],
        mode: s.mode === 'all' ? 'all' : 'any',
        approverFields,
        skipIfNoApprover: Boolean(s.skipIfNoApprover),
      };
    });
  } catch {
    return null;
  }
}

function getUsersInDepartment(dept) {
  if (!dept) return [];
  return db
    .prepare(
      `SELECT id, name, department FROM users WHERE active = 1 AND department = ?`
    )
    .all(String(dept));
}

function resolveUnitName(d) {
  return d || '';
}

function parseCosignIds(raw) {
  if (raw == null || raw === '' || raw === 'skip') return [];
  if (Array.isArray(raw)) {
    return [...new Set(raw.map(Number).filter((n) => n > 0 && Number.isFinite(n)))];
  }
  return [
    ...new Set(
      String(raw)
        .split(/[,，\s]+/)
        .map(Number)
        .filter((n) => n > 0 && Number.isFinite(n))
    ),
  ];
}

/** 與 index.js resolveStepsForRequest 對齊（請購會用到的類型） */
function resolveStepsForRequest(requester, formData, templateSteps) {
  const resolved = [];
  for (const s of templateSteps) {
    let approverIds = [];
    let resolveNote = '';

    if (s.assignType === 'users') {
      approverIds = [...(s.approverIds || [])].map(Number).filter(Boolean);
      resolveNote = '指定人員';
    } else if (s.assignType === 'users_pick') {
      const pool = (s.approverIds || []).map(Number).filter(Boolean);
      if (!pool.length) {
        if (s.skipIfNoApprover) continue;
        return { error: `步驟「${s.name}」尚未設定可選簽核人` };
      }
      const fieldId = `users_pick_${s.order}`;
      const raw = formData?.[fieldId];
      const emptyPick =
        raw === undefined ||
        raw === null ||
        raw === '' ||
        raw === 'skip' ||
        raw === '0';
      if (emptyPick) {
        if (s.skipIfNoApprover) continue;
        return { error: `請勾選「${s.name}」（至少一位）` };
      }
      if (String(raw) === 'all') {
        approverIds = [...pool];
        resolveNote = '申請人勾選全部';
      } else {
        let ids = [];
        if (Array.isArray(raw)) {
          ids = raw.map(Number).filter((n) => n > 0 && Number.isFinite(n));
        } else {
          ids = String(raw)
            .split(/[,，\s]+/)
            .map(Number)
            .filter((n) => n > 0 && Number.isFinite(n));
        }
        ids = [...new Set(ids)];
        if (!ids.length) {
          if (s.skipIfNoApprover) continue;
          return { error: `請勾選「${s.name}」（至少一位）` };
        }
        for (const uid of ids) {
          if (!pool.includes(uid)) {
            return { error: `步驟「${s.name}」所選人員不在可選名單內` };
          }
          if (uid === requester.id) {
            return { error: `步驟「${s.name}」不可選擇申請人本人` };
          }
          const u = db
            .prepare(`SELECT id FROM users WHERE id = ? AND active = 1`)
            .get(uid);
          if (!u) return { error: `步驟「${s.name}」所選人員無效` };
        }
        approverIds = ids;
        resolveNote = `申請人勾選：${ids.join(',')}`;
      }
    } else if (s.assignType === 'dept_head') {
      const fieldId = `dept_head_${s.order}`;
      const raw = formData?.[fieldId];
      const skip =
        raw === undefined ||
        raw === null ||
        raw === '' ||
        raw === 'skip' ||
        raw === '0' ||
        Number(raw) === 0 ||
        Number.isNaN(Number(raw));
      if (skip) continue;
      const uid = Number(raw);
      const u = db
        .prepare(`SELECT id, name, department FROM users WHERE id = ? AND active = 1`)
        .get(uid);
      if (!u) return { error: `步驟「${s.name}」所選人員無效` };
      if (u.id === requester.id) {
        return { error: `步驟「${s.name}」不可選擇申請人本人` };
      }
      approverIds = [u.id];
      resolveNote = `申請人指定：${u.name}`;
    } else if (s.assignType === 'cosign_pick') {
      const fieldId = `cosign_${s.order}`;
      const ids = parseCosignIds(formData?.[fieldId]);
      if (!ids.length) continue;
      approverIds = ids;
      resolveNote = `會簽：${ids.join(',')}`;
      resolved.push({
        order: s.order,
        name: s.name,
        assignType: s.assignType,
        formFieldId: s.formFieldId,
        department: s.department,
        mode: approverIds.length > 1 ? 'all' : s.mode === 'all' ? 'all' : 'any',
        approverIds,
        resolveNote,
        approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
      });
      continue;
    } else if (s.assignType === 'department') {
      let members = getUsersInDepartment(s.department).filter(
        (m) => m.id !== requester.id
      );
      if (!members.length) {
        members = getUsersInDepartment('管理部').filter((m) => m.id !== requester.id);
      }
      if (!members.length) {
        return {
          error: `步驟「${s.name}」對應單位「${resolveUnitName(s.department) || s.department}」尚無可用簽核人`,
        };
      }
      approverIds = members.map((m) => m.id);
      resolveNote = `單位：${resolveUnitName(s.department)}`;
    } else if (s.assignType === 'form_user') {
      const uid = Number(formData?.[s.formFieldId]);
      if (!uid) {
        return { error: `請在表單選擇「${s.name}」` };
      }
      const u = db
        .prepare(`SELECT id, name FROM users WHERE id = ? AND active = 1`)
        .get(uid);
      if (!u) return { error: `步驟「${s.name}」所選人員無效` };
      approverIds = [u.id];
      resolveNote = `表單指定：${u.name}`;
    }

    if (!approverIds.length) continue;

    resolved.push({
      order: s.order,
      name: s.name,
      assignType: s.assignType,
      formFieldId: s.formFieldId,
      department: s.department,
      mode: s.mode,
      approverIds,
      resolveNote,
      approverFields: Array.isArray(s.approverFields) ? s.approverFields : [],
    });
  }

  if (!resolved.length) {
    return { error: '無法建立簽核步驟（可能缺少可用的簽核人）' };
  }
  return {
    steps: resolved.map((s, i) => ({ ...s, order: i + 1 })),
  };
}

function isStepFullyApproved(actions, step) {
  const name = String(step.name || '');
  const approves = (actions || []).filter(
    (a) => a.action === 'approve' && String(a.step_name || '') === name
  );
  if (!approves.length) return false;
  if (step.mode === 'all') {
    const actors = new Set(approves.map((a) => Number(a.actor_id)));
    return (step.approverIds || []).every((id) => actors.has(Number(id)));
  }
  return true;
}

function hasVgmApproved(actions) {
  return (actions || []).some(
    (a) => a.action === 'approve' && /副總/.test(String(a.step_name || ''))
  );
}

function formatSteps(steps) {
  return (steps || [])
    .map(
      (s) =>
        `${s.order}.${s.name}[${(s.approverIds || []).join(',')}]${
          s.mode === 'all' ? '(all)' : ''
        }`
    )
    .join(' → ');
}

function main() {
  console.log(APPLY ? '=== APPLY 模式（會寫入資料庫）===' : '=== DRY-RUN（僅預覽）===');

  const workflows = db
    .prepare(
      `SELECT id, name, steps_json FROM workflows WHERE active = 1 AND name LIKE '%請購%'`
    )
    .all();
  if (!workflows.length) {
    console.error('找不到啟用中的請購流程');
    process.exit(1);
  }

  let total = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const wf of workflows) {
    const template = parseSteps(wf.steps_json);
    if (!template?.length) {
      console.warn(`流程 #${wf.id} ${wf.name} 無步驟，略過`);
      continue;
    }
    console.log(`\n流程 #${wf.id} ${wf.name}`);
    console.log(
      '  模板:',
      template
        .map(
          (s) =>
            `${s.order}.${s.name}(${s.assignType}${
              s.skipIfNoApprover ? ',選填' : ''
            })`
        )
        .join(' → ')
    );

    const rows = db
      .prepare(
        `SELECT r.* FROM approval_requests r
         WHERE r.workflow_id = ? AND r.status = 'pending'
         ORDER BY r.id ASC`
      )
      .all(wf.id);

    for (const r of rows) {
      total += 1;
      const actions = db
        .prepare(
          `SELECT id, action, step_order, step_name, actor_id FROM approval_actions
           WHERE request_id = ? ORDER BY id ASC`
        )
        .all(r.id);

      if (hasVgmApproved(actions)) {
        console.log(`  #${r.id} 略過：副總已核准`);
        skipped += 1;
        continue;
      }

      let formData = {};
      try {
        formData = JSON.parse(r.form_data || '{}');
      } catch {
        formData = {};
      }
      let oldSnap = [];
      try {
        oldSnap = JSON.parse(r.steps_snapshot_json || '[]') || [];
      } catch {
        oldSnap = [];
      }
      if (!Array.isArray(oldSnap)) oldSnap = [];

      const requester = db
        .prepare(
          `SELECT id, name, department, role FROM users WHERE id = ?`
        )
        .get(r.requester_id);
      if (!requester) {
        console.log(`  #${r.id} 錯誤：找不到申請人`);
        errors += 1;
        continue;
      }

      const resolved = resolveStepsForRequest(requester, formData, template);
      if (resolved.error) {
        console.log(`  #${r.id} 錯誤：${resolved.error}`);
        errors += 1;
        continue;
      }

      // 已完整核准的步驟（依舊快照順序、步驟名稱）保留
      const kept = [];
      for (const s of oldSnap) {
        if (isStepFullyApproved(actions, s)) {
          kept.push({ ...s });
        } else {
          break;
        }
      }
      // 若舊快照不完整，改以「歷程中已核准的步驟名稱」對新解析結果前綴比對
      if (!kept.length && oldSnap.length) {
        // 可能第一步就還沒簽完 — kept 空是正常的
      }

      const keptNames = new Set(kept.map((s) => s.name));
      const remaining = (resolved.steps || []).filter((s) => !keptNames.has(s.name));
      // 若新解析把已簽步驟拿掉了，仍保留 kept
      const merged = [...kept, ...remaining].map((s, i) => ({
        ...s,
        order: i + 1,
      }));

      if (!merged.length) {
        console.log(`  #${r.id} 錯誤：合併後無步驟`);
        errors += 1;
        continue;
      }

      // current_step = 第一個尚未完整核准的步驟
      let currentStep = 1;
      for (const s of merged) {
        if (isStepFullyApproved(actions, s)) {
          currentStep = s.order + 1;
        } else {
          currentStep = s.order;
          break;
        }
      }
      if (currentStep > merged.length) {
        // 全部都簽完卻仍 pending — 不自動結案，保持最後一步
        currentStep = merged.length;
      }

      const before = formatSteps(oldSnap);
      const after = formatSteps(merged);
      const changed =
        before !== after || Number(r.current_step) !== Number(currentStep);

      if (!changed) {
        console.log(`  #${r.id} 無變更 cur=${r.current_step} | ${before}`);
        skipped += 1;
        continue;
      }

      console.log(`  #${r.id} 將更新`);
      console.log(`    前: cur=${r.current_step} | ${before}`);
      console.log(`    後: cur=${currentStep} | ${after}`);

      if (APPLY) {
        db.prepare(
          `UPDATE approval_requests
           SET steps_snapshot_json = ?,
               current_step = ?,
               updated_at = datetime('now', 'localtime')
           WHERE id = ? AND status = 'pending'`
        ).run(JSON.stringify(merged), currentStep, r.id);

        db.prepare(
          `INSERT INTO approval_actions
            (request_id, step_order, step_name, actor_id, action, comment, form_data)
           VALUES (?, ?, ?, ?, 'comment', ?, '{}')`
        ).run(
          r.id,
          currentStep,
          '系統調整',
          r.requester_id,
          '依最新請購流程重算簽核步驟（批量：尚未至副總經理）'
        );
        updated += 1;
      } else {
        updated += 1; // dry-run 計為「將更新」
      }
    }
  }

  console.log('\n--- 結果 ---');
  console.log(`掃描 pending：${total}`);
  console.log(`${APPLY ? '已更新' : '將更新'}：${updated}`);
  console.log(`略過：${skipped}`);
  console.log(`錯誤：${errors}`);
  if (!APPLY && updated > 0) {
    console.log('\n確認無誤後執行：node server/resync-purchase-pre-vgm.js --apply');
  }
}

main();
