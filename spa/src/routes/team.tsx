import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  IconUsers, IconTrash, IconLock, IconShieldHalf, IconEye,
  IconUserPlus, IconX, IconCopy, IconCheck
} from '@tabler/icons-react';
import { apiClient } from '@/lib/api-client';
import { isOwner } from '@/lib/auth';
import { relativeTimeAr } from '@/lib/format';
import { PageSpinner } from '@/components/page-spinner';

type Role = 'owner' | 'manager' | 'viewer';

interface User {
  id: number; email: string; name: string;
  role: Role; is_active: boolean;
  created_at: string; last_login_at: string | null;
}

const ROLE_META: Record<Role, { label: string; bg: string; fg: string; icon: React.ReactNode; desc: string }> = {
  owner:   { label: 'المالك',     bg: 'var(--color-primary-light)', fg: 'var(--color-primary)', icon: <IconShieldHalf size={13} />, desc: 'صلاحيات كاملة بما فيها إدارة الفريق' },
  manager: { label: 'مدير',       bg: 'var(--color-good-light)',    fg: '#047857',              icon: <IconLock size={13} />,       desc: 'كل الصلاحيات عدا إدارة الفريق' },
  viewer:  { label: 'مشاهد فقط',  bg: '#F1F3F5',                     fg: 'var(--color-text-2)',  icon: <IconEye size={13} />,        desc: 'قراءة فقط — لا تعديل' }
};

export default function TeamPage() {
  const ownerView = isOwner();
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ user: User; invite_url: string; note?: string } | null>(null);

  const usersQ = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient<{ items: User[] }>('/api/users'),
    staleTime: 60_000
  });

  if (usersQ.isLoading) return <PageSpinner />;

  const users = usersQ.data?.items ?? [];

  return (
    <div className="p-7" style={{ maxWidth: 1400 }}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.3px] text-[var(--color-text-1)] m-0">الفريق والصلاحيات</h1>
          <p className="mt-1 text-[13.5px] text-[var(--color-text-2)]">
            {users.length === 0
              ? 'لم تتم إضافة أي عضو فريق بعد'
              : `${users.length} عضو في الفريق`}
          </p>
        </div>
        {ownerView ? (
          <button type="button" onClick={() => { setInviting(true); setInviteResult(null); }}
            className="flex items-center gap-1.5 rounded-[7px] px-3.5 py-1.5 text-[13px] font-medium text-white"
            style={{ background: 'var(--color-primary)' }}>
            <IconUserPlus size={14} />دعوة عضو جديد
          </button>
        ) : null}
      </div>

      {!ownerView ? (
        <div className="mb-4 rounded-[7px] px-4 py-3 text-[12.5px]"
          style={{ background: '#FFFBEB', color: '#92400E', border: '1px solid #FDE68A' }}>
          <IconLock size={13} className="inline -mb-0.5 me-1" />
          أنت تعرض فريق المنشأة بصلاحيات محدودة. تعديل الأعضاء متاح للمالك فقط.
        </div>
      ) : null}

      {/* Owner master key entry — virtual row, always present */}
      <div className="mb-3 rounded-[10px] p-4 flex items-center justify-between"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-primary)', borderInlineStartWidth: 4 }}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontSize: 14, fontWeight: 600 }}>R</div>
          <div>
            <div className="text-[14px] font-semibold text-[var(--color-text-1)]">المالك — مفتاح المنشأة</div>
            <div className="mt-0.5 text-[12px] text-[var(--color-text-3)]">يدخل عبر مفتاح API. لا يمكن حذفه.</div>
          </div>
        </div>
        <RoleBadge role="owner" />
      </div>

      {/* Users list */}
      {users.length === 0 ? (
        <div className="rounded-[10px] p-12" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex flex-col items-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)' }}>
              <IconUsers size={22} />
            </div>
            <div className="mt-3 text-[14px] font-semibold text-[var(--color-text-1)]">لا يوجد أعضاء فريق بعد</div>
            <div className="mt-1 text-[12.5px] text-[var(--color-text-3)] max-w-md">
              أضف مديرين ومشاهدين ليتمكنوا من الدخول للوحة التحكم بصلاحياتهم المحددة.
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-[10px] overflow-hidden" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <table className="w-full text-[13px]">
            <thead style={{ background: '#FAFBFC' }}>
              <tr>
                <th className="text-right px-4 py-2.5 font-medium text-[11.5px] text-[var(--color-text-3)] uppercase tracking-wide">الاسم</th>
                <th className="text-right px-4 py-2.5 font-medium text-[11.5px] text-[var(--color-text-3)] uppercase tracking-wide">البريد الإلكتروني</th>
                <th className="text-right px-4 py-2.5 font-medium text-[11.5px] text-[var(--color-text-3)] uppercase tracking-wide">الصلاحية</th>
                <th className="text-right px-4 py-2.5 font-medium text-[11.5px] text-[var(--color-text-3)] uppercase tracking-wide">آخر دخول</th>
                <th className="text-right px-4 py-2.5 font-medium text-[11.5px] text-[var(--color-text-3)] uppercase tracking-wide">الحالة</th>
                {ownerView ? <th className="px-4 py-2.5" style={{ width: 80 }}></th> : null}
              </tr>
            </thead>
            <tbody>
              {users.map(u => <UserRow key={u.id} user={u} ownerView={ownerView} />)}
            </tbody>
          </table>
        </div>
      )}

      {inviting ? <InviteModal onClose={() => setInviting(false)} onSuccess={setInviteResult} /> : null}
      {inviteResult ? <InviteResultModal data={inviteResult} onClose={() => setInviteResult(null)} /> : null}
    </div>
  );
}

function RoleBadge({ role }: { role: Role }) {
  const m = ROLE_META[role];
  return (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-medium"
      style={{ background: m.bg, color: m.fg }}>
      {m.icon}{m.label}
    </span>
  );
}

function UserRow({ user, ownerView }: { user: User; ownerView: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);

  const update = useMutation({
    mutationFn: async (patch: { role?: Role; is_active?: boolean }) =>
      apiClient(`/api/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] })
  });
  const del = useMutation({
    mutationFn: async () => apiClient(`/api/users/${user.id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] })
  });

  return (
    <tr style={{ borderTop: '1px solid var(--color-border)' }}>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold"
            style={{ background: '#F1F3F5', color: 'var(--color-text-2)' }}>{(user.name || '?').slice(0, 2)}</div>
          <span className={`font-medium text-[var(--color-text-1)] ${user.is_active ? '' : 'opacity-50'}`}>{user.name}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-[var(--color-text-2)]" dir="ltr">{user.email}</td>
      <td className="px-4 py-3">
        {editing ? (
          <select value={user.role}
            onChange={(e) => { update.mutate({ role: e.target.value as Role }); setEditing(false); }}
            disabled={update.isPending}
            className="rounded-[6px] border border-[var(--color-border-strong)] bg-white px-2 py-1 text-[12.5px]">
            <option value="manager">مدير</option>
            <option value="viewer">مشاهد</option>
          </select>
        ) : (
          <RoleBadge role={user.role} />
        )}
      </td>
      <td className="px-4 py-3 text-[12.5px] text-[var(--color-text-3)]">
        {user.last_login_at ? relativeTimeAr(user.last_login_at) : 'لم يدخل بعد'}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-medium"
          style={user.is_active
            ? { background: 'var(--color-good-light)', color: '#047857' }
            : { background: 'var(--color-bad-light)', color: '#B91C1C' }}>
          {user.is_active ? 'نشط' : 'معطّل'}
        </span>
      </td>
      {ownerView ? (
        <td className="px-4 py-3">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setEditing(e => !e)} disabled={update.isPending}
              className="rounded-[6px] p-1.5 hover:bg-[#F4F5F7]" title="تغيير الصلاحية">
              <IconShieldHalf size={14} style={{ color: 'var(--color-text-3)' }} />
            </button>
            <button type="button" onClick={() => update.mutate({ is_active: !user.is_active })} disabled={update.isPending}
              className="rounded-[6px] p-1.5 hover:bg-[#F4F5F7]" title={user.is_active ? 'تعطيل' : 'تفعيل'}>
              <IconLock size={14} style={{ color: 'var(--color-text-3)' }} />
            </button>
            <button type="button" onClick={() => { if (confirm(`حذف ${user.name}؟ لا يمكن التراجع.`)) del.mutate(); }}
              disabled={del.isPending}
              className="rounded-[6px] p-1.5 hover:bg-[var(--color-bad-light)]" title="حذف">
              <IconTrash size={14} style={{ color: 'var(--color-bad)' }} />
            </button>
          </div>
        </td>
      ) : null}
    </tr>
  );
}

function InviteModal({ onClose, onSuccess }:
  { onClose: () => void; onSuccess: (r: { user: User; invite_url: string; note?: string }) => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'manager' | 'viewer'>('viewer');
  const [error, setError] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: async () =>
      apiClient<{ user: User; invite_url: string; note?: string }>('/api/users', {
        method: 'POST', body: JSON.stringify({ email: email.trim(), name: name.trim(), role })
      }),
    onSuccess: (data) => { onSuccess(data); onClose(); },
    onError: (e) => setError(e instanceof Error ? e.message : 'تعذر إرسال الدعوة')
  });

  return (
    <Modal onClose={onClose} title="دعوة عضو جديد">
      <form onSubmit={(e) => { e.preventDefault(); setError(null); invite.mutate(); }} className="space-y-3">
        <Field label="الاسم">
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={invite.isPending} autoFocus
            placeholder="مثلاً: أحمد المالكي"
            className="w-full rounded-[7px] border border-[var(--color-border-strong)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)]" />
        </Field>
        <Field label="البريد الإلكتروني">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={invite.isPending} dir="ltr"
            placeholder="user@example.com"
            className="w-full rounded-[7px] border border-[var(--color-border-strong)] bg-white px-3 py-2 text-[13px] outline-none focus:border-[var(--color-primary)]" />
        </Field>
        <Field label="الصلاحية">
          <div className="grid grid-cols-2 gap-2">
            {(['manager', 'viewer'] as const).map(r => {
              const m = ROLE_META[r];
              const active = role === r;
              return (
                <button key={r} type="button" onClick={() => setRole(r)}
                  className="rounded-[7px] border p-3 text-start transition"
                  style={{
                    borderColor: active ? 'var(--color-primary)' : 'var(--color-border)',
                    background: active ? 'var(--color-primary-50)' : 'var(--color-surface)'
                  }}>
                  <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: active ? 'var(--color-primary)' : 'var(--color-text-1)' }}>
                    {m.icon}{m.label}
                  </div>
                  <div className="mt-1 text-[11.5px] text-[var(--color-text-3)]">{m.desc}</div>
                </button>
              );
            })}
          </div>
        </Field>
        {error ? <div className="rounded-[7px] px-3 py-2 text-[12.5px]" style={{ background: 'var(--color-bad-light)', color: 'var(--color-bad)' }}>{error}</div> : null}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} disabled={invite.isPending}
            className="rounded-[7px] border px-3.5 py-2 text-[13px] font-medium"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-1)' }}>إلغاء</button>
          <button type="submit" disabled={invite.isPending || !email || !name}
            className="rounded-[7px] px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50"
            style={{ background: 'var(--color-primary)' }}>
            {invite.isPending ? 'جاري…' : 'إرسال الدعوة'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InviteResultModal({ data, onClose }:
  { data: { user: User; invite_url: string; note?: string }; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(data.invite_url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <Modal onClose={onClose} title="تم إنشاء الحساب">
      <div className="space-y-3">
        <div className="rounded-[7px] p-3" style={{ background: 'var(--color-good-light)', color: '#047857' }}>
          <div className="text-[13px] font-medium">تم إنشاء حساب {data.user.name}</div>
          <div className="mt-0.5 text-[12px]">{data.user.email}</div>
        </div>
        {data.note ? (
          <div className="rounded-[7px] p-3 text-[12.5px]" style={{ background: '#FFFBEB', color: '#92400E' }}>{data.note}</div>
        ) : null}
        <div>
          <div className="text-[12.5px] font-medium text-[var(--color-text-2)] mb-1.5">رابط الدعوة (صالح 7 أيام)</div>
          <div className="flex gap-2">
            <input readOnly value={data.invite_url} dir="ltr"
              onClick={(e) => (e.target as HTMLInputElement).select()}
              className="flex-1 rounded-[7px] border border-[var(--color-border-strong)] bg-white px-3 py-2 text-[11.5px] font-mono cursor-pointer" />
            <button type="button" onClick={copy}
              className="flex items-center gap-1 rounded-[7px] px-3 py-2 text-[12.5px] font-medium text-white"
              style={{ background: 'var(--color-primary)' }}>
              {copied ? <><IconCheck size={13} />تم</> : <><IconCopy size={13} />نسخ</>}
            </button>
          </div>
        </div>
        <button type="button" onClick={onClose}
          className="w-full rounded-[7px] py-2 text-[13px] font-medium" style={{ background: '#F4F5F7', color: 'var(--color-text-1)' }}>
          تم
        </button>
      </div>
    </Modal>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <button type="button" onClick={onClose} className="absolute inset-0" style={{ background: 'rgba(10,14,26,0.4)' }} />
      <div className="relative w-full max-w-md rounded-[10px]" style={{ background: 'var(--color-surface)' }}>
        <header className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="text-[15px] font-semibold text-[var(--color-text-1)] m-0">{title}</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق" className="rounded-[6px] p-1.5 hover:bg-[#F4F5F7]">
            <IconX size={15} style={{ color: 'var(--color-text-3)' }} />
          </button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[12.5px] font-medium text-[var(--color-text-2)] mb-1.5">{label}</span>
      {children}
    </label>
  );
}
