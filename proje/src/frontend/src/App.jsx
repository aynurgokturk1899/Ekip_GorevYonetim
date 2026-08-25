import { useEffect, useState } from 'react';
import { changePassword, login, request, uploadAttachment } from './api';
import './auth.css';
import './list.css';
import './account.css';
import './modal.css';

const cards = [
  ['Aktif Projeler', 'ActiveProjectCount', '🗂️'],
  ['Açık Görevler', 'OpenTaskCount', '✓'],
  ['Bana Atananlar', 'MyOpenTaskCount', '👤'],
  ['Okunmamış Bildirim', 'UnreadNotificationCount', '🔔']
];

export default function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('session') ?? 'null'));
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState('dashboard');
  const [items, setItems] = useState([]);
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskProjects, setTaskProjects] = useState([]);
  const [taskStatusFilter, setTaskStatusFilter] = useState('');
  const [detailTask, setDetailTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const canManageProjects = session?.roles?.includes('ProjectManager');
  const canViewProjects = session?.roles?.some(role => role === 'Admin' || role === 'ProjectManager');

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [dashboard, progress, workload] = await Promise.all([
        request('/api/dashboard/summary'),
        request('/api/reports/project-progress'),
        request('/api/reports/workload')
      ]);
      setSummary({ dashboard, progress, workload });
      setError('');
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoading(false);
    }
  };

  const loadPage = async () => {
    if (page === 'dashboard') return loadDashboard();
    if (page === 'account') return;
    setLoading(true);
    try {
      const endpoint = page === 'tasks' ? `/api/tasks/my?pageSize=50${taskStatusFilter ? `&status=${taskStatusFilter}` : ''}` : page === 'notifications' ? '/api/notifications?pageSize=50' : '/api/projects?pageSize=50';
      const data = await request(endpoint);
      setItems(data.items ?? []);
      setError('');
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (session) loadPage(); }, [session, page, taskStatusFilter]);

  const handleLogin = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    try {
      const result = await login(form.get('email'), form.get('password'));
      localStorage.setItem('accessToken', result.accessToken);
      localStorage.setItem('session', JSON.stringify(result.user));
      setSession(result.user);
      setError('');
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoading(false);
    }
  };

  const updateTaskStatus = async (taskId, status) => {
    setLoading(true);
    try {
      await request(`/api/tasks/${taskId}/status`, { method: 'PATCH', body: JSON.stringify({ status: Number(status) }) });
      setItems(current => current.map(item => item.id === taskId ? { ...item, status: Number(status) } : item));
      setError('');
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoading(false);
    }
  };

  const markNotificationRead = async (notificationId) => {
    try {
      await request(`/api/notifications/${notificationId}/read`, { method: 'PATCH' });
      setItems(current => current.map(item => item.id === notificationId ? { ...item, isRead: true } : item));
    } catch (exception) { setError(exception.message); }
  };

  const markAllNotificationsRead = async () => {
    try {
      await request('/api/notifications/read-all', { method: 'PATCH' });
      setItems(current => current.map(item => ({ ...item, isRead: true })));
    } catch (exception) { setError(exception.message); }
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('newPassword') !== form.get('confirmPassword')) {
      setError('Yeni parolalar eşleşmiyor.');
      return;
    }
    setLoading(true);
    try {
      await changePassword(form.get('currentPassword'), form.get('newPassword'));
      event.currentTarget.reset();
      setError('');
      alert('Parolan başarıyla güncellendi.');
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateProject = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    try {
      const project = await request('/api/projects', { method: 'POST', body: JSON.stringify({ name: form.get('name'), description: form.get('description') || null, startDate: form.get('startDate'), targetEndDate: form.get('targetEndDate') }) });
      setItems(current => [project, ...current]);
      setShowProjectForm(false);
      setError('');
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoading(false);
    }
  };

  const openTaskForm = async () => {
    setLoading(true);
    try {
      const data = await request('/api/projects?pageSize=100');
      setTaskProjects(data.items ?? []);
      setShowTaskForm(true);
      setError('');
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateTask = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    try {
      const task = await request('/api/tasks', { method: 'POST', body: JSON.stringify({ projectId: Number(form.get('projectId')), title: form.get('title'), description: form.get('description') || null, assignedUserId: session.id, priority: Number(form.get('priority')), startDate: form.get('startDate') || null, dueDate: form.get('dueDate') }) });
      setItems(current => [task, ...current]);
      setShowTaskForm(false);
      setError('');
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoading(false);
    }
  };

  const openTaskDetail = async (task) => {
    setLoading(true);
    try {
      setComments(await request(`/api/tasks/${task.id}/comments`));
      setAttachments([]);
      setDetailTask(task);
      setError('');
    } catch (exception) { setError(exception.message); }
    finally { setLoading(false); }
  };

  const addComment = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const comment = await request(`/api/tasks/${detailTask.id}/comments`, { method: 'POST', body: JSON.stringify({ content: form.get('content') }) });
      setComments(current => [...current, comment]);
      event.currentTarget.reset();
    } catch (exception) { setError(exception.message); }
  };

  const uploadFile = async (event) => {
    event.preventDefault();
    const file = event.currentTarget.file.files[0];
    if (!file) return;
    try {
      const attachment = await uploadAttachment(detailTask.id, file);
      setAttachments(current => [...current, attachment]);
      event.currentTarget.reset();
    } catch (exception) { setError(exception.message); }
  };

  if (!session) return <LoginForm onSubmit={handleLogin} error={error} loading={loading} />;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span>✓</span> GörevAkış</div>
      <nav><a className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}>▦ Genel Bakış</a>{canViewProjects && <a className={page === 'projects' ? 'active' : ''} onClick={() => setPage('projects')}>◫ Projeler</a>}<a className={page === 'tasks' ? 'active' : ''} onClick={() => setPage('tasks')}>☑ Görevlerim</a><a className={page === 'notifications' ? 'active' : ''} onClick={() => setPage('notifications')}>◌ Bildirimler</a><a className={page === 'account' ? 'active' : ''} onClick={() => setPage('account')}>⚙ Hesabım</a></nav>
      <button className="logout" onClick={() => { localStorage.clear(); setSession(null); }}>Çıkış yap</button>
    </aside>
    <section className="content">
      <header><div><p className="eyebrow">EKİP ÇALIŞMA ALANI</p><h1>{page === 'dashboard' ? `Hoş geldin, ${session.firstName} 👋` : page === 'tasks' ? 'Görevlerim' : page === 'notifications' ? 'Bildirimler' : page === 'account' ? 'Hesabım' : 'Projeler'}</h1><p>{page === 'dashboard' ? 'Bugünkü işlerini ve ekip ilerlemesini buradan takip et.' : page === 'tasks' ? 'Sana atanmış görevleri takip et.' : page === 'notifications' ? 'Proje ve görev hareketlerinden haberdar ol.' : page === 'account' ? 'Kişisel bilgilerini ve parola güvenliğini yönet.' : 'Yönettiğin projeleri görüntüle.'}</p></div><div className="header-actions">{page === 'projects' && <button onClick={() => setShowProjectForm(true)}>+ Proje oluştur</button>}{page === 'tasks' && <select className="task-filter" value={taskStatusFilter} onChange={event => setTaskStatusFilter(event.target.value)}><option value="">Tüm durumlar</option><option value="1">Yeni</option><option value="2">Devam ediyor</option><option value="3">Beklemede</option><option value="4">Tamamlandı</option><option value="5">İptal edildi</option></select>}{page === 'tasks' && canManageProjects && <button onClick={openTaskForm}>+ Görev oluştur</button>}{page === 'notifications' && <button className="refresh" onClick={markAllNotificationsRead}>Tümünü oku</button>}{page !== 'account' && <button className="refresh" onClick={loadPage}>↻ Yenile</button>}</div></header>
      {error && <div className="alert">{error}</div>}
      {page === 'dashboard' ? <><div className="cards">{cards.map(([label, key, icon]) => <article className="card" key={key}><span className="icon">{icon}</span><p>{label}</p><strong>{summary?.dashboard?.[key] ?? (loading ? '…' : '0')}</strong></article>)}</div>
      <section className="panel"><div className="panel-heading"><div><h2>Proje ilerlemesi</h2><p>Görevlerin tamamlanma durumu</p></div></div>
        {loading && !summary ? <p className="muted">Veriler yükleniyor…</p> : summary?.progress?.length ? <div className="progress-list">{summary.progress.map(project => <div className="progress-item" key={project.projectId}><div><strong>{project.projectName}</strong><span>{project.completedTaskCount} / {project.totalTaskCount} görev tamamlandı</span></div><div className="bar"><i style={{ width: `${project.completionPercentage}%` }} /></div><b>%{project.completionPercentage}</b></div>)}</div> : <p className="muted">Henüz görüntülenecek proje bulunmuyor.</p>}
      </section><section className="panel workload-panel"><div className="panel-heading"><div><h2>İş yükü dağılımı</h2><p>Atanan görevlerin ekip bazlı görünümü</p></div></div>{summary?.workload?.length ? <div className="workload-table"><div className="workload-head"><span>Kullanıcı</span><span>Açık görev</span><span>Toplam görev</span></div>{summary.workload.map(user => <div className="workload-row" key={user.userId}><span><b>{user.firstName} {user.lastName}</b><small>{user.email}</small></span><span>{user.openTaskCount}</span><span>{user.totalTaskCount}</span></div>)}</div> : <p className="muted">Henüz iş yükü verisi bulunmuyor.</p>}</section></> : page === 'account' ? <AccountPanel session={session} onSubmit={handleChangePassword} loading={loading} /> : <ListPanel page={page} items={items} loading={loading} onStatusChange={updateTaskStatus} onNotificationRead={markNotificationRead} onTaskDetail={openTaskDetail} />}
      {showProjectForm && <ProjectModal onClose={() => setShowProjectForm(false)} onSubmit={handleCreateProject} loading={loading} />}
      {showTaskForm && <TaskModal projects={taskProjects} onClose={() => setShowTaskForm(false)} onSubmit={handleCreateTask} loading={loading} />}
      {detailTask && <TaskDetailModal task={detailTask} comments={comments} attachments={attachments} onClose={() => setDetailTask(null)} onSubmit={addComment} onUpload={uploadFile} />}
    </section>
  </main>;
}

function AccountPanel({ session, onSubmit, loading }) {
  return <div className="account-grid"><section className="panel account-summary"><div className="avatar">{session.firstName?.[0]}{session.lastName?.[0]}</div><h2>{session.firstName} {session.lastName}</h2><p>{session.email}</p><span className="role-tag">{session.roles?.join(' · ')}</span></section><section className="panel password-panel"><h2>Parola değiştir</h2><p className="muted">Hesabını korumak için güçlü ve benzersiz bir parola kullan.</p><form onSubmit={onSubmit}><label>Mevcut parola<input required name="currentPassword" type="password" /></label><label>Yeni parola<input required minLength="8" name="newPassword" type="password" placeholder="En az 8 karakter" /></label><label>Yeni parola tekrarı<input required name="confirmPassword" type="password" /></label><button disabled={loading}>{loading ? 'Kaydediliyor…' : 'Parolayı güncelle'}</button></form></section></div>;
}

function ProjectModal({ onClose, onSubmit, loading }) {
  const today = new Date().toISOString().slice(0, 10);
  return <div className="modal-backdrop"><section className="modal"><div className="modal-header"><h2>Yeni proje</h2><button className="close-button" type="button" onClick={onClose}>×</button></div><form onSubmit={onSubmit}><label>Proje adı<input required minLength="3" name="name" placeholder="Örn. Mobil uygulama" /></label><label>Açıklama<textarea name="description" rows="3" placeholder="Projenin amacı ve kapsamı" /></label><div className="name-fields"><label>Başlangıç<input required name="startDate" defaultValue={today} type="date" /></label><label>Hedef bitiş<input required name="targetEndDate" type="date" /></label></div><button disabled={loading}>{loading ? 'Oluşturuluyor…' : 'Projeyi oluştur'}</button></form></section></div>;
}

function TaskModal({ projects, onClose, onSubmit, loading }) {
  const today = new Date().toISOString().slice(0, 10);
  return <div className="modal-backdrop"><section className="modal"><div className="modal-header"><h2>Yeni görev</h2><button className="close-button" type="button" onClick={onClose}>×</button></div>{projects.length ? <form onSubmit={onSubmit}><label>Proje<select required name="projectId"><option value="">Proje seç</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Görev başlığı<input required minLength="3" name="title" placeholder="Örn. Giriş ekranını tamamla" /></label><label>Açıklama<textarea name="description" rows="3" /></label><div className="name-fields"><label>Öncelik<select name="priority" defaultValue="2"><option value="1">Düşük</option><option value="2">Orta</option><option value="3">Yüksek</option><option value="4">Acil</option></select></label><label>Başlangıç<input name="startDate" defaultValue={today} type="date" /></label></div><label>Son tarih<input required name="dueDate" type="date" /></label><p className="muted">Görev başlangıçta sana atanacaktır.</p><button disabled={loading}>{loading ? 'Oluşturuluyor…' : 'Görevi oluştur'}</button></form> : <p className="muted">Önce bir proje oluşturmalısın.</p>}</section></div>;
}

function TaskDetailModal({ task, comments, attachments, onClose, onSubmit, onUpload }) {
  return <div className="modal-backdrop"><section className="modal team-modal"><div className="modal-header"><div><h2>{task.title}</h2><p className="muted">Görev yorumları ve dosyalar</p></div><button className="close-button" type="button" onClick={onClose}>×</button></div><div className="comment-list">{comments.length ? comments.map(comment => <article className="comment" key={comment.id}><p>{comment.content}</p><span>{new Date(comment.createdDate).toLocaleString('tr-TR')}</span></article>) : <p className="muted">Henüz yorum yok.</p>}</div><form onSubmit={onSubmit}><label>Yeni yorum<textarea required name="content" maxLength="1500" rows="3" placeholder="Görevle ilgili güncellemeni yaz…" /></label><button>Yorum ekle</button></form><form className="upload-form" onSubmit={onUpload}><label>Dosya ekle<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.txt" /></label><button>Dosyayı yükle</button></form>{attachments.length > 0 && <div className="attachment-list">{attachments.map(file => <span key={file.id}>📎 {file.originalFileName} ({Math.ceil(file.fileSize / 1024)} KB)</span>)}</div>}</section></div>;
}

function ListPanel({ page, items, loading, onStatusChange, onNotificationRead, onTaskDetail }) {
  if (loading) return <section className="panel"><p className="muted">Veriler yükleniyor…</p></section>;
  if (!items.length) return <section className="panel"><p className="muted">Henüz görüntülenecek kayıt bulunmuyor.</p></section>;
  return <section className="panel list-panel">{items.map(item => page === 'notifications' ? <article className={`list-row notification ${item.isRead ? '' : 'unread'}`} key={item.id} onClick={() => !item.isRead && onNotificationRead(item.id)}><div><strong>{item.title}</strong><span>{item.message} · {new Date(item.createdDate).toLocaleString('tr-TR')}</span></div><b className="badge">{item.isRead ? 'Okundu' : 'Yeni'}</b></article> : <article className="list-row" key={item.id}><div><strong>{item.title ?? item.name}</strong><span>{item.dueDate ? `Son tarih: ${item.dueDate} · Öncelik: ${priorityText(item.priority)}` : `${item.startDate} — ${item.targetEndDate}`}</span></div>{page === 'tasks' ? <div className="row-actions"><select className="status-select" value={item.status} onChange={event => onStatusChange(item.id, event.target.value)}><option value="1">Yeni</option><option value="2">Devam ediyor</option><option value="3">Beklemede</option><option value="4">Tamamlandı</option><option value="5">İptal edildi</option></select><button className="mini-button" onClick={() => onTaskDetail(item)}>Yorumlar</button></div> : <b className="badge">{statusText(item.status)}</b>}</article>)}</section>;
}

const statusText = (status) => ({ 1: 'Yeni', 2: 'Devam ediyor', 3: 'Beklemede', 4: 'Tamamlandı', 5: 'İptal edildi' }[status] ?? status);
const priorityText = (priority) => ({ 1: 'Düşük', 2: 'Orta', 3: 'Yüksek', 4: 'Acil' }[priority] ?? priority);

function LoginForm({ onSubmit, error, loading }) {
  return <main className="login-page"><section className="login-card"><div className="logo">✓</div><p className="eyebrow">EKİP GÖREV YÖNETİMİ</p><h1>Tekrar hoş geldin</h1><p className="muted">Çalışma alanına devam etmek için giriş yap.</p><form onSubmit={onSubmit}><label>E-posta<input required name="email" type="email" placeholder="ornek@firma.com" /></label><label>Parola<input required name="password" type="password" placeholder="••••••••" /></label>{error && <div className="alert">{error}</div>}<button disabled={loading}>{loading ? 'Giriş yapılıyor…' : 'Giriş yap'}</button></form></section></main>;
}
