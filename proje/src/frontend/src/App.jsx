import { useEffect, useState } from 'react';
import { changePassword, login, register, request, uploadAttachment } from './api';
import './auth.css';
import './list.css';
import './account.css';
import './modal.css';

const cards = [
  ['Aktif Projeler', 'activeProjectCount', '🗂️', 'projects', 'Çalışma alanındaki projeler'],
  ['Açık Görevler', 'openTaskCount', '✓', 'tasks', 'Tamamlanmayı bekleyen işler'],
  ['Bana Atananlar', 'myOpenTaskCount', '👤', 'tasks', 'Sana ait açık görevler'],
  ['Okunmamış Bildirim', 'unreadNotificationCount', '🔔', 'notifications', 'Yeni gelişmeleri kontrol et']
];

export default function App() {
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('session') ?? 'null'));
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [page, setPage] = useState('dashboard');
  const [items, setItems] = useState([]);
  const [adminOverview, setAdminOverview] = useState({ users: [], projects: [] });
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [taskProjects, setTaskProjects] = useState([]);
  const [taskMembers, setTaskMembers] = useState([]);
  const [projectManagers, setProjectManagers] = useState([]);
  const [taskStatusFilter, setTaskStatusFilter] = useState('');
  const [detailTask, setDetailTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [attachments, setAttachments] = useState([]);
  const isAdmin = session?.roles?.includes('Admin');
  const canManageProjects = isAdmin || session?.roles?.includes('ProjectManager');
  const canViewProjects = Boolean(session);

  const loadDashboard = async () => {
    setLoading(true);
    try {
      const [dashboard, progress, workload, todayTasks] = await Promise.all([
        request('/api/dashboard/summary'),
        request('/api/reports/project-progress'),
        request('/api/reports/workload'),
        request('/api/tasks/my?pageSize=5&sort=duedate:asc')
      ]);
      setSummary({ dashboard, progress, workload, todayTasks: todayTasks.items ?? [] });
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
      if (page === 'admin') {
        const [users, projects] = await Promise.all([
          request('/api/users?pageSize=100&isActive=true'),
          request('/api/projects?pageSize=100')
        ]);
        setAdminOverview({ users: users.items ?? [], projects: projects.items ?? [] });
        setError('');
        return;
      }
      const endpoint = page === 'tasks' ? `/api/tasks/my?pageSize=50${taskStatusFilter ? `&status=${taskStatusFilter}` : ''}` : page === 'notifications' ? '/api/notifications?pageSize=50' : page === 'requests' ? '/api/project-join-requests/pending' : page === 'myRequests' ? '/api/project-join-requests/my' : `/api/projects?pageSize=50${canManageProjects ? '' : '&availableForJoin=true'}`;
      const data = await request(endpoint);
      setItems(data.items ?? data ?? []);
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

  const handleRegister = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (form.get('password') !== form.get('confirmPassword')) {
      setError('Parolalar eşleşmiyor.');
      return;
    }
    setLoading(true);
    try {
      const result = await register({ firstName: form.get('firstName'), lastName: form.get('lastName'), email: form.get('email'), password: form.get('password') });
      localStorage.setItem('accessToken', result.accessToken);
      localStorage.setItem('session', JSON.stringify(result.user));
      setSession(result.user);
      setError('');
    } catch (exception) { setError(exception.message); }
    finally { setLoading(false); }
  };

  const sendJoinRequest = async (projectId) => {
    setLoading(true);
    try { await request(`/api/projects/${projectId}/join-requests`, { method: 'POST' }); await loadPage(); }
    catch (exception) { setError(exception.message); }
    finally { setLoading(false); }
  };

  const reviewJoinRequest = async (id, approve) => {
    setLoading(true);
    try { await request(`/api/project-join-requests/${id}/${approve ? 'approve' : 'reject'}`, { method: 'PATCH' }); setItems(current => current.filter(item => item.id !== id)); }
    catch (exception) { setError(exception.message); }
    finally { setLoading(false); }
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
      const project = await request('/api/projects', { method: 'POST', body: JSON.stringify({ name: form.get('name'), description: form.get('description') || null, startDate: form.get('startDate'), targetEndDate: form.get('targetEndDate'), managerUserId: isAdmin ? form.get('managerUserId') : null }) });
      setItems(current => [project, ...current]);
      setShowProjectForm(false);
      setError('');
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoading(false);
    }
  };

  const openProjectForm = async () => {
    setLoading(true);
    try {
      if (isAdmin) {
        const data = await request('/api/users?pageSize=100&isActive=true');
        setProjectManagers(data.items ?? []);
      }
      setShowProjectForm(true);
      setError('');
    } catch (exception) { setError(exception.message); }
    finally { setLoading(false); }
  };

  const openTaskForm = async () => {
    setLoading(true);
    try {
      const data = await request('/api/projects?pageSize=100');
      setTaskProjects(data.items ?? []);
      setTaskMembers([]);
      setShowTaskForm(true);
      setError('');
    } catch (exception) {
      setError(exception.message);
    } finally {
      setLoading(false);
    }
  };

  const loadTaskMembers = async (projectId) => {
    if (!projectId) { setTaskMembers([]); return; }
    try {
      setTaskMembers(await request(`/api/projects/${projectId}/members`));
      setError('');
    } catch (exception) { setTaskMembers([]); setError(exception.message); }
  };

  const handleCreateTask = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    try {
      const task = await request('/api/tasks', { method: 'POST', body: JSON.stringify({ projectId: Number(form.get('projectId')), title: form.get('title'), description: form.get('description') || null, assignedUserId: form.get('assignedUserId'), priority: Number(form.get('priority')), startDate: form.get('startDate') || null, dueDate: form.get('dueDate') }) });
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

  if (!session) return <LoginForm isRegistering={isRegistering} onSubmit={isRegistering ? handleRegister : handleLogin} onSwitch={() => { setError(''); setIsRegistering(!isRegistering); }} error={error} loading={loading} />;

  return <main className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span>✓</span> GörevAkış</div>
      <nav><a className={page === 'dashboard' ? 'active' : ''} onClick={() => setPage('dashboard')}>▦ Genel Bakış</a>{isAdmin && <a className={page === 'admin' ? 'active' : ''} onClick={() => setPage('admin')}>♛ Yönetim Paneli</a>}{canViewProjects && <a className={page === 'projects' ? 'active' : ''} onClick={() => setPage('projects')}>◫ Projeler</a>} {!canManageProjects && <a className={page === 'myRequests' ? 'active' : ''} onClick={() => setPage('myRequests')}>◌ Katılım isteklerim</a>}{canManageProjects && <a className={page === 'requests' ? 'active' : ''} onClick={() => setPage('requests')}>◌ Katılım istekleri</a>}<a className={page === 'tasks' ? 'active' : ''} onClick={() => setPage('tasks')}>☑ Görevlerim</a><a className={page === 'notifications' ? 'active' : ''} onClick={() => setPage('notifications')}>◌ Bildirimler</a><a className={page === 'account' ? 'active' : ''} onClick={() => setPage('account')}>⚙ Hesabım</a></nav>
      <button className="logout" onClick={() => { localStorage.clear(); setSession(null); }}>Çıkış yap</button>
    </aside>
    <section className="content">
      <header><div><p className="eyebrow">EKİP ÇALIŞMA ALANI</p><h1>{page === 'dashboard' ? `Hoş geldin, ${session.firstName} 👋` : page === 'admin' ? 'Yönetim Paneli' : page === 'tasks' ? 'Görevlerim' : page === 'notifications' ? 'Bildirimler' : page === 'account' ? 'Hesabım' : page === 'requests' ? 'Katılım istekleri' : page === 'myRequests' ? 'Katılım isteklerim' : 'Projeler'}</h1><p>{page === 'admin' ? 'Ekip üyelerini incele, proje oluştur ve proje yöneticisi ata.' : page === 'projects' && isAdmin ? 'Projeyi oluştur ve ekipten bir proje yöneticisi ata.' : page === 'projects' && !canManageProjects ? 'Uygun projeye katılım isteği gönder.' : page === 'requests' ? 'Yönettiğin projelere gelen istekleri değerlendir.' : page === 'myRequests' ? 'Gönderdiğin isteklerin durumunu takip et.' : 'Çalışma alanını buradan takip et.'}</p></div><div className="header-actions">{(page === 'projects' || page === 'admin') && isAdmin && <button onClick={openProjectForm}>+ Proje oluştur ve yönetici ata</button>}{page === 'projects' && !isAdmin && canManageProjects && <button onClick={openProjectForm}>+ Proje oluştur</button>}{page === 'tasks' && <select className="task-filter" value={taskStatusFilter} onChange={event => setTaskStatusFilter(event.target.value)}><option value="">Tüm durumlar</option><option value="1">Yeni</option><option value="2">Devam ediyor</option><option value="3">Beklemede</option><option value="4">Tamamlandı</option><option value="5">İptal edildi</option></select>}{page === 'tasks' && canManageProjects && <button onClick={openTaskForm}>+ Görev oluştur</button>}{page === 'notifications' && <button className="refresh" onClick={markAllNotificationsRead}>Tümünü oku</button>}{page !== 'account' && <button className="refresh" onClick={loadPage}>↻ Yenile</button>}</div></header>
      {error && <div className="alert">{error}</div>}
      {page === 'dashboard' ? <><section className="dashboard-hero"><div className="dashboard-profile"><span className="dashboard-avatar">{session.firstName?.[0]}{session.lastName?.[0]}</span><div><b>{session.firstName} {session.lastName}</b><small>{session.roles?.join(' · ')}</small></div></div><div className="dashboard-date"><span>BUGÜN</span><b>{new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</b></div></section><div className="cards">{cards.map(([label, key, icon, targetPage, detail]) => <article className="card clickable-card" key={key} role="button" tabIndex="0" onClick={() => setPage(targetPage)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') setPage(targetPage); }}><span className="icon">{icon}</span><p>{label}</p><strong>{summary?.dashboard?.[key] ?? (loading ? '…' : '0')}</strong><small className="card-detail">{detail}</small></article>)}</div>
      <section className="panel today-panel"><div className="panel-heading"><div><h2>Bugünün görevleri</h2><p>Öncelik vermen gereken en yakın işler</p></div><button className="mini-button" onClick={() => setPage('tasks')}>Tüm görevler</button></div>{summary?.todayTasks?.length ? <div className="today-list">{summary.todayTasks.map(task => <button className="today-task" key={task.id} onClick={() => setPage('tasks')}><span className="today-task-icon">{task.priority >= 3 ? '!' : '✓'}</span><span><b>{task.title}</b><small>Son tarih: {task.dueDate} · {priorityText(task.priority)}</small></span><i>{statusText(task.status)}</i></button>)}</div> : <p className="muted">Bugün için sana atanmış açık görev bulunmuyor.</p>}</section>
      <section className="panel"><div className="panel-heading"><div><h2>Proje ilerlemesi</h2><p>Görevlerin tamamlanma durumu</p></div></div>
        {loading && !summary ? <p className="muted">Veriler yükleniyor…</p> : summary?.progress?.length ? <div className="progress-list">{summary.progress.map(project => <div className="progress-item" key={project.projectId}><div><strong>{project.projectName}</strong><span>{project.completedTaskCount} / {project.totalTaskCount} görev tamamlandı</span></div><div className="bar"><i style={{ width: `${project.completionPercentage}%` }} /></div><b>%{project.completionPercentage}</b></div>)}</div> : <p className="muted">Henüz görüntülenecek proje bulunmuyor.</p>}
      </section><section className="panel workload-panel"><div className="panel-heading"><div><h2>İş yükü dağılımı</h2><p>Atanan görevlerin ekip bazlı görünümü</p></div></div>{summary?.workload?.length ? <div className="workload-table"><div className="workload-head"><span>Kullanıcı</span><span>Açık görev</span><span>Toplam görev</span></div>{summary.workload.map(user => <div className="workload-row" key={user.userId}><span><b>{user.firstName} {user.lastName}</b><small>{user.email}</small></span><span>{user.openTaskCount}</span><span>{user.totalTaskCount}</span></div>)}</div> : <p className="muted">Henüz iş yükü verisi bulunmuyor.</p>}</section></> : page === 'admin' ? <AdminPanel overview={adminOverview} loading={loading} /> : page === 'account' ? <AccountPanel session={session} onSubmit={handleChangePassword} loading={loading} /> : <ListPanel page={page} items={items} loading={loading} canJoin={!canManageProjects} onStatusChange={updateTaskStatus} onNotificationRead={markNotificationRead} onTaskDetail={openTaskDetail} onJoin={sendJoinRequest} onReview={reviewJoinRequest} />}
      {showProjectForm && <ProjectModal isAdmin={isAdmin} managers={projectManagers} onClose={() => setShowProjectForm(false)} onSubmit={handleCreateProject} loading={loading} />}
      {showTaskForm && <TaskModal projects={taskProjects} members={taskMembers} onProjectChange={loadTaskMembers} onClose={() => setShowTaskForm(false)} onSubmit={handleCreateTask} loading={loading} />}
      {detailTask && <TaskDetailModal task={detailTask} comments={comments} attachments={attachments} onClose={() => setDetailTask(null)} onSubmit={addComment} onUpload={uploadFile} />}
    </section>
  </main>;
}

function AccountPanel({ session, onSubmit, loading }) {
  return <div className="account-grid"><section className="panel account-summary"><div className="avatar">{session.firstName?.[0]}{session.lastName?.[0]}</div><h2>{session.firstName} {session.lastName}</h2><p>{session.email}</p><span className="role-tag">{session.roles?.join(' · ')}</span></section><section className="panel password-panel"><h2>Parola değiştir</h2><p className="muted">Hesabını korumak için güçlü ve benzersiz bir parola kullan.</p><form onSubmit={onSubmit}><label>Mevcut parola<input required name="currentPassword" type="password" /></label><label>Yeni parola<input required minLength="8" name="newPassword" type="password" placeholder="En az 8 karakter" /></label><label>Yeni parola tekrarı<input required name="confirmPassword" type="password" /></label><button disabled={loading}>{loading ? 'Kaydediliyor…' : 'Parolayı güncelle'}</button></form></section></div>;
}

function ProjectModal({ isAdmin, managers, onClose, onSubmit, loading }) {
  const today = new Date().toISOString().slice(0, 10);
  return <div className="modal-backdrop"><section className="modal"><div className="modal-header"><h2>Yeni proje</h2><button className="close-button" type="button" onClick={onClose}>×</button></div><form onSubmit={onSubmit}><label>Proje adı<input required minLength="3" name="name" placeholder="Örn. Mobil uygulama" /></label>{isAdmin && <label>Proje yöneticisi<select required name="managerUserId" defaultValue=""><option value="" disabled>Ekipten kullanıcı seç</option>{managers.map(user => <option key={user.id} value={user.id}>{user.firstName} {user.lastName} · {user.email}</option>)}</select></label>}<label>Açıklama<textarea name="description" rows="3" placeholder="Projenin amacı ve kapsamı" /></label><div className="name-fields"><label>Başlangıç<input required name="startDate" defaultValue={today} type="date" /></label><label>Hedef bitiş<input required name="targetEndDate" type="date" /></label></div><button disabled={loading}>{loading ? 'Oluşturuluyor…' : 'Projeyi oluştur'}</button></form></section></div>;
}

function AdminPanel({ overview, loading }) {
  return <>
    <section className="panel"><div className="panel-heading"><div><h2>Ekip üyeleri</h2><p>Kayıtlı ve aktif kullanıcılar</p></div><b>{overview.users.length}</b></div>{loading ? <p className="muted">Yükleniyor…</p> : overview.users.length ? <div className="workload-table"><div className="workload-head"><span>Kullanıcı</span><span>Rol</span><span>Durum</span></div>{overview.users.map(user => <div className="workload-row" key={user.id}><span><b>{user.firstName} {user.lastName}</b><small>{user.email}</small></span><span>{user.roles?.join(', ') || 'Ekip üyesi'}</span><span>Aktif</span></div>)}</div> : <p className="muted">Henüz ekip üyesi yok.</p>}</section>
    <section className="panel"><div className="panel-heading"><div><h2>Projeler</h2><p>Sistemdeki tüm aktif projeler</p></div><b>{overview.projects.length}</b></div>{overview.projects.length ? <div className="workload-table"><div className="workload-head"><span>Proje</span><span>Tarih</span><span>Durum</span></div>{overview.projects.map(project => <div className="workload-row" key={project.id}><span><b>{project.name}</b><small>{project.description || 'Açıklama yok'}</small></span><span>{project.startDate} — {project.targetEndDate}</span><span>{statusText(project.status)}</span></div>)}</div> : <p className="muted">Henüz proje oluşturulmadı.</p>}</section>
  </>;
}

function TaskModal({ projects, members, onProjectChange, onClose, onSubmit, loading }) {
  const today = new Date().toISOString().slice(0, 10);
  return <div className="modal-backdrop"><section className="modal"><div className="modal-header"><h2>Yeni görev</h2><button className="close-button" type="button" onClick={onClose}>×</button></div>{projects.length ? <form onSubmit={onSubmit}><label>Proje<select required name="projectId" onChange={event => onProjectChange(event.target.value)}><option value="">Proje seç</option>{projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label>Görevi ata<select required name="assignedUserId" disabled={!members.length}><option value="">{members.length ? 'Ekip üyesi seç' : 'Önce proje seç'}</option>{members.map(member => <option key={member.userId} value={member.userId}>{member.firstName} {member.lastName} · {member.email}</option>)}</select></label><label>Görev başlığı<input required minLength="3" name="title" placeholder="Örn. Giriş ekranını tamamla" /></label><label>Açıklama<textarea name="description" rows="3" /></label><div className="name-fields"><label>Öncelik<select name="priority" defaultValue="2"><option value="1">Düşük</option><option value="2">Orta</option><option value="3">Yüksek</option><option value="4">Acil</option></select></label><label>Başlangıç<input name="startDate" defaultValue={today} type="date" /></label></div><label>Son tarih<input required name="dueDate" type="date" /></label><p className="muted">Yalnızca onaylanmış aktif proje üyeleri seçilebilir.</p><button disabled={loading || !members.length}>{loading ? 'Oluşturuluyor…' : 'Görevi oluştur'}</button></form> : <p className="muted">Önce bir proje oluşturmalısın.</p>}</section></div>;
}

function TaskDetailModal({ task, comments, attachments, onClose, onSubmit, onUpload }) {
  return <div className="modal-backdrop"><section className="modal team-modal"><div className="modal-header"><div><h2>{task.title}</h2><p className="muted">Görev yorumları ve dosyalar</p></div><button className="close-button" type="button" onClick={onClose}>×</button></div><div className="comment-list">{comments.length ? comments.map(comment => <article className="comment" key={comment.id}><p>{comment.content}</p><span>{new Date(comment.createdDate).toLocaleString('tr-TR')}</span></article>) : <p className="muted">Henüz yorum yok.</p>}</div><form onSubmit={onSubmit}><label>Yeni yorum<textarea required name="content" maxLength="1500" rows="3" placeholder="Görevle ilgili güncellemeni yaz…" /></label><button>Yorum ekle</button></form><form className="upload-form" onSubmit={onUpload}><label>Dosya ekle<input name="file" type="file" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.txt" /></label><button>Dosyayı yükle</button></form>{attachments.length > 0 && <div className="attachment-list">{attachments.map(file => <span key={file.id}>📎 {file.originalFileName} ({Math.ceil(file.fileSize / 1024)} KB)</span>)}</div>}</section></div>;
}

function ListPanel({ page, items, loading, canJoin, onStatusChange, onNotificationRead, onTaskDetail, onJoin, onReview }) {
  if (loading) return <section className="panel"><p className="muted">Veriler yükleniyor…</p></section>;
  if (!items.length) return <section className="panel"><p className="muted">Henüz görüntülenecek kayıt bulunmuyor.</p></section>;
  return <section className="panel list-panel">{items.map(item => page === 'notifications' ? <article className={`list-row notification ${item.isRead ? '' : 'unread'}`} key={item.id} onClick={() => !item.isRead && onNotificationRead(item.id)}><div><strong>{item.title}</strong><span>{item.message} · {new Date(item.createdDate).toLocaleString('tr-TR')}</span></div><b className="badge">{item.isRead ? 'Okundu' : 'Yeni'}</b></article> : <article className="list-row" key={item.id}><div><strong>{page === 'requests' ? `${item.firstName} ${item.lastName} · ${item.projectName}` : item.title ?? item.name ?? item.projectName}</strong><span>{page === 'myRequests' ? `${item.projectName} · ${statusText(item.status)}` : page === 'requests' ? `${item.email} · ${new Date(item.createdDate).toLocaleString('tr-TR')}` : item.dueDate ? `Son tarih: ${item.dueDate} · Öncelik: ${priorityText(item.priority)}` : `${item.startDate} — ${item.targetEndDate}`}</span></div>{page === 'tasks' ? <div className="row-actions"><select className="status-select" value={item.status} onChange={event => onStatusChange(item.id, event.target.value)}><option value="1">Yeni</option><option value="2">Devam ediyor</option><option value="3">Beklemede</option><option value="4">Tamamlandı</option><option value="5">İptal edildi</option></select><button className="mini-button" onClick={() => onTaskDetail(item)}>Yorumlar</button></div> : page === 'projects' && canJoin ? <button className="mini-button" onClick={() => onJoin(item.id)}>Katılma isteği gönder</button> : page === 'requests' ? <div className="row-actions"><button className="mini-button" onClick={() => onReview(item.id, true)}>Onayla</button><button className="mini-button" onClick={() => onReview(item.id, false)}>Reddet</button></div> : <b className="badge">{page === 'myRequests' ? statusText(item.status) : statusText(item.status)}</b>}</article>)}</section>;
}

const statusText = (status) => ({ 1: 'Yeni', 2: 'Devam ediyor', 3: 'Beklemede', 4: 'Tamamlandı', 5: 'İptal edildi' }[status] ?? status);
const priorityText = (priority) => ({ 1: 'Düşük', 2: 'Orta', 3: 'Yüksek', 4: 'Acil' }[priority] ?? priority);

function LoginForm({ isRegistering, onSubmit, onSwitch, error, loading }) {
  return <main className="login-page"><div className="auth-layout"><section className="login-card"><div className="logo">✓</div><p className="eyebrow">EKİP GÖREV YÖNETİMİ</p><h1>{isRegistering ? 'Hesap oluştur' : 'Tekrar hoş geldin'}</h1><p className="muted">{isRegistering ? 'Hesabını hemen oluştur; ardından istediğin projeye katılım isteği gönder.' : 'Çalışma alanına devam etmek için giriş yap.'}</p><form onSubmit={onSubmit}>{isRegistering && <div className="name-fields"><label>Ad<input required name="firstName" /></label><label>Soyad<input required name="lastName" /></label></div>}<label>E-posta<input required name="email" type="email" placeholder="ornek@firma.com" /></label><label>Parola<input required minLength="8" name="password" type="password" placeholder="En az 8 karakter" /></label>{isRegistering && <label>Parola tekrarı<input required name="confirmPassword" type="password" /></label>}{error && <div className="alert">{error}</div>}<button disabled={loading}>{loading ? 'İşleniyor…' : isRegistering ? 'Kayıt ol' : 'Giriş yap'}</button></form><p className="switch-text">{isRegistering ? 'Zaten hesabın var mı?' : 'Henüz hesabın yok mu?'} <button type="button" onClick={onSwitch}>{isRegistering ? 'Giriş yap' : 'Kayıt ol'}</button></p></section><aside className="auth-visual"><div className="bug-swarm" aria-hidden="true">{Array.from({ length: 20 }, (_, index) => <span className="auth-bug" style={{ '--x': `${(index * 37) % 92}%`, '--y': `${(index * 53) % 88}%`, '--size': `${15 + (index % 3) * 3}px`, '--duration': `${9 + (index % 5) * 1.7}s`, '--delay': `${index * -0.7}s` }} key={index}>🐞</span>)}</div><p className="eyebrow">BİRLİKTE DAHA DÜZENLİ</p><h2>İşlerin, ekibin ve projelerin tek bir yerde.</h2><p>Görevleri takip et, projene katıl ve ekip akışından kopma.</p><div className="visual-pills"><span>Projeler</span><span>Görevler</span><span>Takip</span></div></aside></div></main>;
}
