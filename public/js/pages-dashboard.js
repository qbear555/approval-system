/**
 * 總覽頁
 * 依賴 app.js 掛到 window 的 state、$、api、esc、toast、navigate 等。
 */
async function renderDashboard(body) {
  const { stats } = await api('/api/stats');
  const { requests } = await api('/api/requests?filter=pending_me');
  let announcement = { active: false };
  try {
    const annRes = await api('/api/announcement');
    announcement = annRes.announcement || announcement;
  } catch {
    /* ignore */
  }
  const pendingList = requests.slice(0, 8);
  const canWf = hasPerm('workflows');
  const canUsers = hasPerm('users_leave');
  const isFinanceStaff = isFinanceStaffUser();

  const announcementHtml =
    announcement && announcement.active
      ? `<div class="card announcement-card" style="background:#fffbeb;border-color:#fbbf24;margin-bottom:16px;padding:0;overflow:hidden">
          <button type="button" class="announcement-open" id="btn-announcement-open"
            style="display:block;width:100%;text-align:left;border:0;background:transparent;padding:18px 20px;cursor:pointer">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
              <div style="flex:1;min-width:200px">
                <div style="font-size:1.55rem;font-weight:800;color:#b45309;letter-spacing:0.12em;margin-bottom:8px;line-height:1.2">公告</div>
                <strong style="color:#92400e;font-size:1.15rem;line-height:1.4;display:block">${esc(announcement.title || '公司公告')}</strong>
                ${
                  announcement.body
                    ? `<p style="margin:8px 0 0;font-size:0.98rem;color:#78350f;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap">${esc(announcement.body)}</p>`
                    : ''
                }
              </div>
              <span class="btn outline sm" style="pointer-events:none;white-space:nowrap;border-color:#f59e0b;color:#92400e">查看</span>
            </div>
          </button>
        </div>`
      : '';

  const finNoticeHtml =
    isFinanceStaff && stats.pendingFinanceConfirm > 0
      ? `<div class="card" style="background:#ecfdf5;border-color:#6ee7b7;margin-bottom:16px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <strong style="color:#065f46;font-size:1.05rem">📊 待財務部授信額度建檔確認（${stats.pendingFinanceConfirm} 筆）</strong>
              <p style="margin:4px 0 0;font-size:0.88rem;color:#047857">
                總經理已完成核定。請於 ERP 完成授信額度設定後，點擊「前往處理」進行建檔確認。
              </p>
            </div>
            <button type="button" class="btn success" data-go="inbox" style="white-space:nowrap;font-weight:600">前往處理 (${stats.pendingFinanceConfirm})</button>
          </div>
        </div>`
      : '';

  const applicantAckNoticeHtml =
    stats.pendingApplicantAck > 0
      ? `<div class="card" style="background:#f0fdf4;border-color:#86efac;margin-bottom:16px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <strong style="color:#166534;font-size:1.05rem">📊 財務部已完成授信額度建檔（${stats.pendingApplicantAck} 筆待您確認）</strong>
              <p style="margin:4px 0 0;font-size:0.88rem;color:#15803d">
                財務部已完成您申請的授信額度建檔。請點擊「前往確認」並點選「我知道了」。
              </p>
            </div>
            <button type="button" class="btn success" data-go="inbox" style="white-space:nowrap;font-weight:600">前往確認 (${stats.pendingApplicantAck})</button>
          </div>
        </div>`
      : '';

  const finalNotifyNoticeHtml =
    stats.pendingFinalNotify > 0
      ? `<div class="card" style="background:#eff6ff;border-color:#93c5fd;margin-bottom:16px;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div>
              <strong style="color:#1e40af;font-size:1.05rem">🔔 最終核准通知（${stats.pendingFinalNotify} 筆待確認）</strong>
              <p style="margin:4px 0 0;font-size:0.88rem;color:#1d4ed8">
                有申請單已最終核准。請假相關請<strong>設定 Email 自動回覆</strong>後，開啟單據點確認。
              </p>
            </div>
            <button type="button" class="btn primary" data-go="inbox" style="white-space:nowrap;font-weight:600">前往確認 (${stats.pendingFinalNotify})</button>
          </div>
        </div>`
      : '';

  body.innerHTML = `
    ${finNoticeHtml}
    ${applicantAckNoticeHtml}
    ${finalNotifyNoticeHtml}
    ${announcementHtml}
    <div class="stats-grid">
      ${statCardHtml({
        label: '待我簽核',
        value: stats.pendingMe ?? 0,
        go: 'inbox',
        hint: '前往待簽核列表',
      })}
      ${
        isFinanceStaff
          ? statCardHtml({
              label: '待財務建檔',
              value: stats.pendingFinanceConfirm ?? 0,
              go: 'inbox',
              hint: '待財務部額度建檔確認',
            })
          : ''
      }
      ${
        stats.pendingApplicantAck > 0
          ? statCardHtml({
              label: '待確認建檔',
              value: stats.pendingApplicantAck ?? 0,
              go: 'inbox',
              hint: '待您確認財務建檔結果',
            })
          : ''
      }
      ${statCardHtml({
        label: '我的進行中',
        value: stats.minePending ?? 0,
        go: 'mine',
        hint: '查看我的申請',
      })}
      ${statCardHtml({
        label: '我已完成',
        value: stats.mineDone ?? 0,
        go: 'mine',
        hint: '查看我的申請',
      })}
      ${statCardHtml({
        label: '本月申請',
        value: stats.monthlyRequests ?? 0,
        hint: '本月（1日起）我送出的申請數',
      })}
      ${statCardHtml({
        label: '平均簽核天數',
        value: stats.avgApprovalDays != null ? `${stats.avgApprovalDays} 天` : '—',
        hint: '我已核准單據的平均簽核天數',
      })}

      ${statCardHtml({
        label: '啟用中流程',
        value: stats.workflows ?? 0,
        go: canWf ? 'workflows' : undefined,
        hint: canWf ? '管理簽核流程' : '需流程管理權限',
        disabled: !canWf,
      })}
    </div>
    <div class="card">
      <div class="card-head">
        <h3>待辦簽核</h3>
        ${
          pendingList.length
            ? `<button type="button" class="btn outline sm" data-go="inbox">查看全部</button>`
            : ''
        }
      </div>
      ${requestTable(pendingList, {
        empty: {
          title: '目前沒有待簽核項目',
          desc: '有單據輪到您簽核時會顯示在這裡，也可從左側「待我簽核」進入。',
          actions: [
            { label: '＋ 新增申請', go: 'new-request', primary: true },
            { label: '我的申請', go: 'mine', outline: true },
          ],
        },
      })}
    </div>
    <div class="card">
      <h3>快速開始</h3>
      <div class="form-actions">
        <button type="button" class="btn primary" data-go="new-request">＋ 新增申請</button>
        ${
          canWf
            ? `<button type="button" class="btn outline" data-go="workflows">管理簽核流程</button>`
            : ''
        }
        ${
          hasPerm('backups')
            ? `<button type="button" class="btn outline" data-go="backups">備份資料</button>`
            : ''
        }
        ${
          isAdmin()
            ? `<button type="button" class="btn outline" data-go="users">成員權限</button>`
            : canUsers
              ? `<button type="button" class="btn outline" data-go="users">成員休假</button>`
              : ''
        }
        <button type="button" class="btn outline" data-go="inbox">查看待簽核</button>
      </div>
    </div>
  `;
  bindDataGo(body);
  bindRequestRows(body);

  $('#btn-announcement-open')?.addEventListener('click', () => {
    openAnnouncementModal(announcement);
  });
}

/** ISO → datetime-local 輸入值（本機時區） */
