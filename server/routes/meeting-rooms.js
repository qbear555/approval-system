'use strict';

const mail = require('../mail');

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

module.exports = function registerMeetingRooms(app, { db, authMiddleware }) {
  /**
   * 發送會議預約 Email 通知給與會同仁
   */
  async function sendBookingNotificationMail({ booking, organizer, room, attendeeIds }) {
    try {
      if (!attendeeIds || !attendeeIds.length) return;
      const cleanIds = attendeeIds.map((id) => Number(id)).filter((id) => id > 0);
      if (!cleanIds.length) return;

      const placeholders = cleanIds.map(() => '?').join(',');
      const attendeeUsers = db
        .prepare(`SELECT id, name, email, department FROM users WHERE id IN (${placeholders}) AND active = 1`)
        .all(...cleanIds);

      const emails = attendeeUsers.map((u) => u.email).filter(Boolean);
      if (!emails.length) return;

      const baseUrl = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3847}`).replace(/\/+$/, '') + '/meeting-rooms';
      const subject = `【會議通知】${booking.title}（${booking.booking_date} ${booking.start_time}~${booking.end_time}）`;
      const attendeeNames = attendeeUsers.map((u) => `${u.name} (${u.department || '同仁'})`).join('、 ');
      const externalGuests = String(booking.external_attendees || '').trim() || (
        booking.attendees && attendeeNames
          ? booking.attendees
              .split(/[、,，]/)
              .map((s) => s.trim())
              .filter((s) => s && !attendeeNames.includes(s) && !attendeeUsers.some((u) => s.startsWith(u.name)))
              .join('、 ')
          : ''
      );

      const html = `
        <div style="font-family: Arial, 'Noto Sans TC', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #2563eb; margin-top: 0;">📅 會議室預約通知</h2>
          <p>您好：</p>
          <p><strong>${escapeHtml(organizer.name)}（${escapeHtml(organizer.department || '')}）</strong>已建立會議排程，並將您列為與會同仁，詳細資訊如下：</p>
          <div style="background-color: #f8fafc; padding: 16px; border-left: 4px solid #2563eb; border-radius: 6px; margin: 16px 0;">
            <p style="margin: 6px 0;"><strong>會議主旨：</strong> <span style="font-size: 1.05rem; font-weight: bold; color: #1e293b;">${escapeHtml(booking.title)}</span></p>
            <p style="margin: 6px 0;"><strong>預約會議室：</strong> ${escapeHtml(room?.name || '會議室')}</p>
            <p style="margin: 6px 0;"><strong>會議日期：</strong> ${escapeHtml(booking.booking_date)}</p>
            <p style="margin: 6px 0;"><strong>會議時間：</strong> <span style="color: #2563eb; font-weight: bold;">${escapeHtml(booking.start_time)} ~ ${escapeHtml(booking.end_time)}</span></p>
            <p style="margin: 6px 0;"><strong>召集人：</strong> ${escapeHtml(organizer.name)}（${escapeHtml(organizer.email || '')}）</p>
            <p style="margin: 6px 0;"><strong>與會同仁：</strong> ${escapeHtml(attendeeNames || '全體同仁')}</p>
            ${externalGuests ? `<p style="margin: 6px 0;"><strong>外部訪客／貴賓：</strong> <span style="color: #b45309; font-weight: bold; background: #fef3c7; padding: 2px 8px; border-radius: 4px;">👥 ${escapeHtml(externalGuests)}</span></p>` : ''}
          </div>
          <p style="margin-top: 20px;">
            <a href="${baseUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold;">
              查看會議排程
            </a>
          </p>
          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
          <p style="color: #64748b; font-size: 0.85rem; margin: 0;">此信件由企業會議室預約系統自動發送，請勿直接回覆。</p>
        </div>
      `;

      const text = `【會議通知】${booking.title}\n時間：${booking.booking_date} ${booking.start_time}~${booking.end_time}\n地點：${room?.name || '會議室'}\n召集人：${organizer.name}\n與會同仁：${attendeeNames}${externalGuests ? `\n外部訪客：${externalGuests}` : ''}\n連結：${baseUrl}`;

      for (const email of emails) {
        await mail.sendMail({
          to: email,
          subject,
          text,
          html,
        });
      }
    } catch (err) {
      console.error('[meeting-rooms] 发送会议通知失败:', err);
    }
  }

  // 1. 會議室清單
  app.get('/api/meeting-rooms', authMiddleware, (req, res) => {
    try {
      const showAll = req.query.all === '1' && req.user?.role === 'admin';
      const sql = showAll
        ? 'SELECT * FROM meeting_rooms ORDER BY sort_order ASC, id ASC'
        : 'SELECT * FROM meeting_rooms WHERE active = 1 ORDER BY sort_order ASC, id ASC';
      const rooms = db.prepare(sql).all();
      res.json({ rooms });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. 即時使用狀態
  app.get('/api/meeting-rooms/status', authMiddleware, (req, res) => {
    try {
      const rooms = db.prepare('SELECT * FROM meeting_rooms WHERE active = 1 ORDER BY sort_order ASC').all();
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const nowDt = `${todayStr} ${timeStr}`;

      const activeBookings = db
        .prepare(`
          SELECT b.*, u.name AS user_name, u.department AS user_dept
          FROM meeting_bookings b
          LEFT JOIN users u ON b.user_id = u.id
          WHERE b.status = 'confirmed'
            AND b.booking_date = ?
            AND b.start_datetime <= ?
            AND b.end_datetime > ?
        `)
        .all(todayStr, nowDt, nowDt);

      const nextBookings = db
        .prepare(`
          SELECT b.*, u.name AS user_name, u.department AS user_dept
          FROM meeting_bookings b
          LEFT JOIN users u ON b.user_id = u.id
          WHERE b.status = 'confirmed'
            AND b.booking_date = ?
            AND b.start_datetime > ?
          ORDER BY b.start_datetime ASC
        `)
        .all(todayStr, nowDt);

      const statusMap = {};
      for (const r of rooms) {
        const current = activeBookings.find((b) => b.room_id === r.id);
        const next = nextBookings.find((b) => b.room_id === r.id);
        statusMap[r.id] = {
          room: r,
          is_occupied: !!current,
          current_booking: current || null,
          next_booking: next || null,
        };
      }
      res.json({ statuses: statusMap });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. 預約清單
  app.get('/api/meeting-bookings', authMiddleware, (req, res) => {
    try {
      const { date, start_date, end_date, room_id, my_only } = req.query;
      let sql = `
        SELECT b.*,
               r.name AS room_name, r.color AS room_color,
               u.name AS user_name, u.email AS user_email, u.department AS user_dept
        FROM meeting_bookings b
        JOIN meeting_rooms r ON b.room_id = r.id
        JOIN users u ON b.user_id = u.id
        WHERE b.status = 'confirmed'
      `;
      const params = [];

      if (date) {
        sql += ' AND b.booking_date = ?';
        params.push(date);
      } else if (start_date && end_date) {
        sql += ' AND b.booking_date >= ? AND b.booking_date <= ?';
        params.push(start_date, end_date);
      }

      if (room_id) {
        sql += ' AND b.room_id = ?';
        params.push(room_id);
      }

      if (my_only === '1') {
        sql += ' AND b.user_id = ?';
        params.push(req.user.id);
      }

      sql += ' ORDER BY b.booking_date ASC, b.start_time ASC';
      const bookings = db.prepare(sql).all(...params);
      res.json({ bookings });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. 行前 5 分鐘即時提醒 (供頂部通知 Banner 使用)
  app.get('/api/meeting-bookings/reminders', authMiddleware, (req, res) => {
    try {
      const now = new Date();
      const in5Min = new Date(now.getTime() + 5 * 60 * 1000);
      const pad = (n) => String(n).padStart(2, '0');
      const formatDt = (d) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

      const nowStr = formatDt(now);
      const next5Str = formatDt(in5Min);
      const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

      const bookings = db
        .prepare(`
          SELECT b.*, r.name AS room_name, r.color AS room_color,
                 u.name AS user_name, u.department AS user_dept
          FROM meeting_bookings b
          JOIN meeting_rooms r ON b.room_id = r.id
          JOIN users u ON b.user_id = u.id
          WHERE b.status = 'confirmed'
            AND b.booking_date = ?
            AND b.start_datetime > ?
            AND b.start_datetime <= ?
          ORDER BY b.start_datetime ASC
        `)
        .all(todayStr, nowStr, next5Str);

      const userId = req.user.id;
      const myReminders = bookings.filter((b) => {
        if (b.user_id === userId) return true;
        if (b.attendee_ids) {
          const ids = b.attendee_ids.split(',').map((x) => Number(x.trim()));
          if (ids.includes(userId)) return true;
        }
        return false;
      });

      res.json({ reminders: myReminders });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. 新增預約
  app.post('/api/meeting-bookings', authMiddleware, async (req, res) => {
    try {
      const {
        room_id,
        title,
        description,
        booking_date,
        start_time,
        end_time,
        attendee_count,
        attendees,
        attendee_ids,
        external_attendees,
        notify_email,
      } = req.body || {};

      if (!room_id || !title || !booking_date || !start_time || !end_time) {
        return res.status(400).json({ error: '請完整填寫會議室、主旨、日期與起訖時間' });
      }

      if (start_time >= end_time) {
        return res.status(400).json({ error: '結束時間必須大於開始時間' });
      }

      const room = db.prepare('SELECT * FROM meeting_rooms WHERE id = ? AND active = 1').get(room_id);
      if (!room) {
        return res.status(404).json({ error: '指定的會議室不存在或已停用' });
      }

      const start_datetime = `${booking_date} ${start_time}`;
      const end_datetime = `${booking_date} ${end_time}`;

      // 檢查時段衝突
      const conflict = db
        .prepare(`
          SELECT b.*, u.name AS user_name
          FROM meeting_bookings b
          JOIN users u ON b.user_id = u.id
          WHERE b.room_id = ?
            AND b.booking_date = ?
            AND b.status = 'confirmed'
            AND NOT (b.end_datetime <= ? OR b.start_datetime >= ?)
        `)
        .get(room_id, booking_date, start_datetime, end_datetime);

      if (conflict) {
        return res.status(409).json({
          error: `該時段已被「${conflict.user_name}」預約（${conflict.title} ${conflict.start_time}~${conflict.end_time}），請選擇其他時段。`,
        });
      }

      const cleanAttendeeIds = attendee_ids
        ? String(attendee_ids)
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        : [];

      const shouldNotify = notify_email === false || notify_email === 0 ? 0 : 1;

      const result = db
        .prepare(`
          INSERT INTO meeting_bookings (
            room_id, user_id, title, description, booking_date,
            start_time, end_time, start_datetime, end_datetime,
            attendee_count, attendees, attendee_ids, external_attendees, notify_email, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')
        `)
        .run(
          room_id,
          req.user.id,
          title,
          description || '',
          booking_date,
          start_time,
          end_time,
          start_datetime,
          end_datetime,
          attendee_count || 1,
          attendees || '',
          cleanAttendeeIds.join(','),
          String(external_attendees || '').trim(),
          shouldNotify
        );

      const newBooking = db.prepare('SELECT * FROM meeting_bookings WHERE id = ?').get(result.lastInsertRowid);
      const organizer = db.prepare('SELECT name, email, department FROM users WHERE id = ?').get(req.user.id);

      if (shouldNotify && cleanAttendeeIds.length > 0) {
        sendBookingNotificationMail({
          booking: newBooking,
          organizer: organizer || { name: req.user.username, email: '', department: '' },
          room,
          attendeeIds: cleanAttendeeIds,
        }).catch((e) => console.error(e));
      }

      res.json({ success: true, booking: newBooking });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. 修改預約（權限限制：只能修改自己預約的）
  app.put('/api/meeting-bookings/:id', authMiddleware, async (req, res) => {
    try {
      const bookingId = req.params.id;
      const booking = db.prepare('SELECT * FROM meeting_bookings WHERE id = ?').get(bookingId);
      if (!booking) return res.status(404).json({ error: '找不到該預約紀錄' });

      // 嚴格權限檢查
      if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: '您只能修改自己建立的預約，其他人僅能查看' });
      }

      const {
        room_id = booking.room_id,
        title = booking.title,
        description = booking.description,
        booking_date = booking.booking_date,
        start_time = booking.start_time,
        end_time = booking.end_time,
        attendee_count = booking.attendee_count,
        attendees = booking.attendees,
        attendee_ids,
        external_attendees,
        notify_email,
      } = req.body || {};

      if (start_time >= end_time) {
        return res.status(400).json({ error: '結束時間必須大於開始時間' });
      }

      const start_datetime = `${booking_date} ${start_time}`;
      const end_datetime = `${booking_date} ${end_time}`;

      // 衝突檢核 (排除自身)
      const conflict = db
        .prepare(`
          SELECT b.*, u.name AS user_name
          FROM meeting_bookings b
          JOIN users u ON b.user_id = u.id
          WHERE b.room_id = ?
            AND b.booking_date = ?
            AND b.status = 'confirmed'
            AND b.id != ?
            AND NOT (b.end_datetime <= ? OR b.start_datetime >= ?)
        `)
        .get(room_id, booking_date, bookingId, start_datetime, end_datetime);

      if (conflict) {
        return res.status(409).json({
          error: `修改後時段與「${conflict.user_name}」預約衝突（${conflict.title} ${conflict.start_time}~${conflict.end_time}）`,
        });
      }

      const cleanAttendeeIds =
        attendee_ids !== undefined
          ? String(attendee_ids).split(',').map((x) => x.trim()).filter(Boolean)
          : booking.attendee_ids.split(',').filter(Boolean);

      const extAtts =
        external_attendees !== undefined
          ? String(external_attendees).trim()
          : (booking.external_attendees || '');

      const shouldNotify = notify_email === false || notify_email === 0 ? 0 : 1;

      db.prepare(`
        UPDATE meeting_bookings
        SET room_id = ?, title = ?, description = ?, booking_date = ?,
            start_time = ?, end_time = ?, start_datetime = ?, end_datetime = ?,
            attendee_count = ?, attendees = ?, attendee_ids = ?,
            external_attendees = ?, notify_email = ?,
            updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(
        room_id,
        title,
        description || '',
        booking_date,
        start_time,
        end_time,
        start_datetime,
        end_datetime,
        attendee_count,
        attendees || '',
        cleanAttendeeIds.join(','),
        extAtts,
        shouldNotify,
        bookingId
      );

      const updated = db.prepare('SELECT * FROM meeting_bookings WHERE id = ?').get(bookingId);
      const room = db.prepare('SELECT * FROM meeting_rooms WHERE id = ?').get(room_id);
      const organizer = db.prepare('SELECT name, email, department FROM users WHERE id = ?').get(booking.user_id);

      if (shouldNotify && cleanAttendeeIds.length > 0) {
        sendBookingNotificationMail({
          booking: updated,
          organizer: organizer || { name: req.user.username, email: '', department: '' },
          room,
          attendeeIds: cleanAttendeeIds,
        }).catch((e) => console.error(e));
      }

      res.json({ success: true, booking: updated });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. 取消預約（權限限制：只能取消自己預約的）
  app.delete('/api/meeting-bookings/:id', authMiddleware, (req, res) => {
    try {
      const bookingId = req.params.id;
      const booking = db.prepare('SELECT * FROM meeting_bookings WHERE id = ?').get(bookingId);
      if (!booking) return res.status(404).json({ error: '找不到該預約紀錄' });

      if (booking.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: '您只能取消自己建立的預約，其他人僅能查看' });
      }

      db.prepare(`
        UPDATE meeting_bookings
        SET status = 'cancelled', updated_at = datetime('now', 'localtime')
        WHERE id = ?
      `).run(bookingId);

      res.json({ success: true, message: '已取消會議室預約' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
