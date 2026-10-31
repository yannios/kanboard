/*!
 * Kanban UI — Kaneo-style frontend on top of Kanboard's JSON-RPC API.
 * No build step, no framework. Everything it shows comes from Kanboard.
 */
(function () {
    'use strict';

    var ENDPOINT = '../jsonrpc.php';          // same origin as Kanboard → no CORS
    var LS_USER = 'kbui.user', LS_TOKEN = 'kbui.token', LS_THEME = 'kbui.theme', LS_FS = 'kbui.fs';

    var COLOR_HEX = {
        yellow: '#e6c34a', orange: '#e0954f', red: '#d97070', pink: '#d98fc0',
        purple: '#a98fd9', blue: '#6fa8d9', teal: '#6ec7bb', green: '#6fbb6f',
        lime: '#a9c46a', brown: '#a98457', grey: '#9c9c9c'
    };
    var PRIORITY = ['Nizak', 'Srednji', 'Visok', 'Hitan'];
    var ICO = {
        due: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 11h18"/></svg>',
        sub: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-6"/></svg>',
        cmt: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8z"/></svg>',
        pri: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 21V4m0 1h11l-2 4 2 4H5"/></svg>'
    };


    var COL_ICON = ['○', '◐', '◑', '●', '◕'];

    var state = {
        user: localStorage.getItem(LS_USER) || 'admin',
        token: localStorage.getItem(LS_TOKEN) || 'hermes-ui-2026',
        projects: [],
        project: null,
        board: [],            // swimlanes → columns → tasks
        users: [],
        categories: [],
        search: '',
        sort: 'due',
        view: 'board',
        task: null,
        csrfLess: true
    };

    /* ---------------- helpers ---------------- */
    function $(id) { return document.getElementById(id); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function toast(msg, ms) {
        var t = $('toast');
        t.textContent = msg;
        t.hidden = false;
        clearTimeout(t._h);
        t._h = setTimeout(function () { t.hidden = true; }, ms || 2600);
    }
    function ownerName(id) {
        var n = '';
        (state.users || []).forEach(function (u) { if (u.id === id) n = u.name || u.username; });
        if (!n && state.me && state.me.id === id) n = state.me.name || state.me.username;
        return n;
    }

    function initials(name) {
        if (!name) return '';
        return name.trim().split(/\s+/).map(function (p) { return p[0]; }).join('').slice(0, 2).toUpperCase();
    }
    function ref(p) { return (p && p.identifier ? p.identifier : 'KB'); }

    function dueInfo(ts) {
        if (!ts) return null;
        var d = new Date(ts * 1000), now = new Date();
        var day = 86400000;
        var a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        var b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var diff = Math.round((a - b) / day);
        var txt;
        if (diff === 0) txt = 'danas';
        else if (diff === 1) txt = 'sutra';
        else if (diff === -1) txt = 'jučer';
        else if (diff > 1) txt = 'za ' + diff + ' dana';
        else txt = 'prije ' + Math.abs(diff) + ' dana';
        return { text: txt, overdue: diff < 0, soon: diff >= 0 && diff <= 2 };
    }

    /* ---------------- API ---------------- */
    function api(method, params) {
        var auth = 'Basic ' + btoa(state.user + ':' + state.token);
        return fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': auth },
            body: JSON.stringify({ jsonrpc: '2.0', method: method, id: 1, params: params || {} })
        }).then(function (r) { return r.json(); }).then(function (j) {
            if (j.error) throw new Error(j.error.message || 'API greška');
            return j.result;
        });
    }

    function fail(e) {
        toast('Greška: ' + (e && e.message ? e.message : e));
        console.error(e);
    }

    /* ---------------- boot ---------------- */
    function boot() {
        applyTheme(localStorage.getItem(LS_THEME) || 'dark');
        applyFs(localStorage.getItem(LS_FS) || 'md');
        $('aEndpoint').textContent = new URL(ENDPOINT, location.href).href;
        wire();
        if (!state.token) { openAuth(); return; }
        loadAll();
    }

    function applyFs(size) {
        document.documentElement.setAttribute('data-fs', size);
        localStorage.setItem(LS_FS, size);
        var menu = $('fsmenu');
        if (menu) {
            Array.prototype.forEach.call(menu.querySelectorAll('button'), function (b) {
                b.classList.toggle('is-active', b.dataset.fs === size);
                b.style.fontSize = { sm: '.7rem', md: '.8rem', lg: '.95rem', xl: '1.1rem' }[b.dataset.fs];
            });
        }
    }

    function openSide(open) {
        var side = document.querySelector('.side');
        var scrim = $('sideScrim');
        side.classList.toggle('is-open', open);
        scrim.hidden = !open;
    }

    function applyTheme(t) {
        document.documentElement.setAttribute('data-theme', t);
        localStorage.setItem(LS_THEME, t);
        $('themeLabel').textContent = t === 'dark' ? 'Svijetla tema' : 'Tamna tema';
    }

    function loadAll() {
        board.innerHTML = '<div class="col"><div class="empty">Učitavam…</div></div>';
        api('getVersion').then(function (v) {
            $('kbVer').textContent = /unknown|\$Format/.test(v) ? '1.2.57' : v;
            return api('getMe').then(function (me) { state.me = me; return me; }).catch(function () { return null; });
        }).then(function () {
            return api('getAllProjects');
        }).then(function (ps) {
            state.projects = (ps || []).filter(function (p) { return p.is_active; });
            renderProjects();
            var saved = localStorage.getItem('kbui.project');
            state.project = state.projects.filter(function (p) { return String(p.id) === saved; })[0] || state.projects[0];
            if (!state.project) throw new Error('nema aktivnih projekata');
            localStorage.setItem('kbui.project', state.project.id);
            $('projName').textContent = state.project.name;
            $('projIcon').textContent = ref(state.project).slice(0, 2).toUpperCase();
            return Promise.all([
                api('getBoard', { project_id: state.project.id }),
                api('getAllCategories', { project_id: state.project.id }).catch(function () { return []; }),
                api('getAssignableUsers', { project_id: state.project.id }).catch(function () { return []; })
            ]);
        }).then(function (res) {
            state.board = res[0] || [];
            state.categories = res[1] || [];
            var u = res[2] || [];
            state.users = Array.isArray(u) ? u : Object.keys(u).map(function (k) { return u[k]; });
            renderBoard();
            renderList();
            countMine();
            var t = localStorage.getItem('kbui.task');
            if (t) openTask(Number(t), true);
        }).catch(function (e) {
            fail(e);
            if (!state.projects.length) openAuth();
        });
    }

    /* ---------------- render: sidebar ---------------- */
    function renderProjects() {
        $('projects').innerHTML = state.projects.map(function (p) {
            var on = state.project && p.id === state.project.id ? ' is-active' : '';
            return '<button class="nav-item' + on + '" data-project="' + p.id + '">' +
                '<span class="ni">◻</span> ' + esc(p.name) + '</button>';
        }).join('') || '<div class="empty">Nema projekata</div>';
    }

    function countMine() {
        var n = 0;
        allTasks().forEach(function (t) { if (t.owner_id) n++; });
        $('mineCount').textContent = n;
    }

    function allTasks() {
        var out = [];
        state.board.forEach(function (sw) {
            (sw.columns || []).forEach(function (c) {
                (c.tasks || []).forEach(function (t) {
                    if (t.is_active) out.push(t);
                });
            });
        });
        return out;
    }

    /* ---------------- render: board ---------------- */
    var board = $('board');

    function sortTasks(list) {
        var a = list.slice();
        if (state.sort === 'due') {
            a.sort(function (x, y) { return (x.date_due || 9e12) - (y.date_due || 9e12); });
        } else {
            a.sort(function (x, y) { return (y.priority || 0) - (x.priority || 0); });
        }
        return a;
    }

    function cardHTML(t) {
        var p = state.project;
        var id = t.reference || (ref(p) + '-' + t.id);
        var due = dueInfo(t.date_due);
        var who = t.assignee_name || ownerName(t.owner_id);
        var av = initials(who);
        var meta = '';
        if (due) meta += '<span class="chip mono' + (due.overdue ? ' due-over' : due.soon ? ' due-soon' : '') + '">' + ICO.due + ' ' + due.text + '</span>';
        if (t.nb_subtasks) meta += '<span class="chip mono">' + ICO.sub + ' ' + t.nb_completed_subtasks + '/' + t.nb_subtasks + '</span>';
        if (t.nb_comments) meta += '<span class="chip mono">' + ICO.cmt + ' ' + t.nb_comments + '</span>';
        if (t.priority) meta += '<span class="chip mono">' + ICO.pri + ' ' + PRIORITY[t.priority] + '</span>';

        var labels = '';
        if (t.category_name) {
            labels += '<span class="chip"><span class="dot" style="background:' + (COLOR_HEX[t.category_color_id] || 'var(--text-3)') + '"></span>' + esc(t.category_name) + '</span>';
        }
        (t.tags || []).forEach(function (tag) {
            labels += '<span class="chip">' + esc(tag) + '</span>';
        });

        return '<article class="card" draggable="true" data-task="' + t.id + '">' +
            '<div class="card-top"><span class="card-id">' + esc(id) + '</span>' +
            (av ? '<span class="assignee" title="' + esc(who) + '">' + av + '</span>' : '') +
            '</div>' +
            '<div class="card-title">' + esc(t.title) + '</div>' +
            (meta ? '<div class="card-meta">' + meta + '</div>' : '') +
            (labels ? '<div class="card-labels">' + labels + '</div>' : '') +
            '</article>';
    }

    function visible(t) {
        if (!state.search) return true;
        var q = state.search.toLowerCase();
        return (t.title || '').toLowerCase().indexOf(q) > -1 ||
            (t.category_name || '').toLowerCase().indexOf(q) > -1 ||
            (t.assignee_name || '').toLowerCase().indexOf(q) > -1;
    }

    function renderBoard() {
        var cols = [];
        state.board.forEach(function (sw) {
            (sw.columns || []).forEach(function (c) { cols.push({ sw: sw.id, col: c }); });
        });
        if (!cols.length) { board.innerHTML = '<div class="col"><div class="empty">Projekt nema kolona.</div></div>'; return; }

        var total = 0;
        board.innerHTML = cols.map(function (x, i) {
            var c = x.col;
            var tasks = sortTasks((c.tasks || []).filter(function (t) { return t.is_active && visible(t); }));
            total += tasks.length;
            var over = c.task_limit && tasks.length > c.task_limit;
            return '<section class="col" data-swimlane="' + x.sw + '" data-column="' + c.id + '">' +
                '<header class="col-head">' +
                '<span class="col-dot">' + (COL_ICON[i % COL_ICON.length]) + '</span>' +
                '<span class="col-title">' + esc(c.title) + '</span>' +
                '<span class="col-num"' + (over ? ' style="color:var(--danger)"' : '') + '>' + tasks.length + '</span>' +
                '<button class="icon-btn sm" data-add="' + c.id + '" title="Novi zadatak">+</button>' +
                '</header>' +
                '<div class="cards" data-drop="' + c.id + '">' + tasks.map(cardHTML).join('') + '</div>' +
                '</section>';
        }).join('');
        $('taskCount').textContent = total + (total === 1 ? ' zadatak' : ' zadataka');
    }

    /* ---------------- render: list view ---------------- */
    function renderList() {
        var cols = [];
        state.board.forEach(function (sw) {
            (sw.columns || []).forEach(function (c) { cols.push(c); });
        });
        $('listview').innerHTML = cols.map(function (c) {
            var tasks = sortTasks((c.tasks || []).filter(function (t) { return t.is_active && visible(t); }));
            return '<div class="lv-group"><div class="lv-head">' + esc(c.title) +
                ' <span class="col-num">' + tasks.length + '</span></div>' +
                tasks.map(function (t) {
                    var due = dueInfo(t.date_due);
                    var id = t.reference || (ref(state.project) + '-' + t.id);
                    return '<div class="lv-row" data-task="' + t.id + '">' +
                        '<span class="card-id">' + esc(id) + '</span>' +
                        '<span class="lv-title">' + esc(t.title) + '</span>' +
                        (due ? '<span class="chip mono' + (due.overdue ? ' due-over' : due.soon ? ' due-soon' : '') + '">' + ICO.due + ' ' + due.text + '</span>' : '') +
                        (t.category_name ? '<span class="chip"><span class="dot" style="background:' + (COLOR_HEX[t.category_color_id] || 'var(--text-3)') + '"></span>' + esc(t.category_name) + '</span>' : '') +
                        ((t.assignee_name || ownerName(t.owner_id)) ? '<span class="assignee">' + initials(t.assignee_name || ownerName(t.owner_id)) + '</span>' : '') +
                        '</div>';
                }).join('') + '</div>';
        }).join('') || '<div class="empty">Nema zadataka.</div>';
    }

    /* ---------------- task drawer ---------------- */
    function openTask(id, silent) {
        api('getTask', { task_id: id }).then(function (t) {
            state.task = t;
            localStorage.setItem('kbui.task', t.id);
            $('dId').textContent = t.reference || (ref(state.project) + '-' + t.id);
            $('dTitle').value = t.title || '';
            $('dDesc').value = t.description || '';
            $('pProject').textContent = state.project.name;
            $('pColumn').textContent = columnName(t.column_id) || '—';
            $('pPriority').textContent = PRIORITY[t.priority || 0] || 'Nizak';
            $('pCategory').textContent = categoryName(t.category_id) || 'bez kategorije';
            $('pColor').innerHTML = '<span class="dot" style="background:' + (COLOR_HEX[t.color_id] || 'var(--text-3)') + '"></span>' + (t.color_id || 'grey');
            $('pDue').value = t.date_due ? new Date(t.date_due * 1000).toISOString().slice(0, 10) : '';
            $('drawerWrap').hidden = false;
            autosize($('dTitle'));
            return Promise.all([
                api('getAllSubtasks', { task_id: t.id }).catch(function () { return []; }),
                api('getAllComments', { task_id: t.id }).catch(function () { return []; })
            ]);
        }).then(function (res) {
            renderSubtasks(res[0] || []);
            renderComments(res[1] || []);
        }).catch(function (e) { if (!silent) fail(e); localStorage.removeItem('kbui.task'); });
    }

    function categoryName(id) {
        var n = '';
        (state.categories || []).forEach(function (c) { if (c.id === id) n = c.name; });
        return n;
    }

    function columnName(id) {
        var name = '';
        state.board.forEach(function (sw) {
            (sw.columns || []).forEach(function (c) { if (c.id === id) name = c.title; });
        });
        return name;
    }

    function renderSubtasks(subs) {
        var t = state.task;
        var done = subs.filter(function (s) { return s.status == 1; }).length;
        $('dSubCount').textContent = subs.length ? done + '/' + subs.length : '';
        $('dSubtasks').innerHTML = subs.map(function (s) {
            return '<label class="sub' + (s.status == 1 ? ' done' : '') + '">' +
                '<input type="checkbox" data-sub="' + s.id + '"' + (s.status == 1 ? ' checked' : '') + '>' +
                '<span>' + esc(s.title) + '</span></label>';
        }).join('') || '<div class="muted" style="font-size:12.5px;padding:4px 6px">Nema podzadataka.</div>';
    }

    function renderComments(cs) {
        $('dComments').innerHTML = cs.map(function (c) {
            return '<div class="comment"><span class="assignee">' + initials(c.username || c.name) + '</span>' +
                '<div class="body"><div class="who">' + esc(c.name || c.username || 'korisnik') +
                ' · ' + new Date((c.date_creation || 0) * 1000).toLocaleString('hr-HR') + '</div>' +
                esc(c.comment || '') + '</div></div>';
        }).join('') || '<div class="muted" style="font-size:12.5px">Još nema komentara.</div>';
    }

    function closeDrawer() {
        $('drawerWrap').hidden = true;
        localStorage.removeItem('kbui.task');
        state.task = null;
    }

    function autosize(el) {
        el.style.height = 'auto';
        el.style.height = el.scrollHeight + 'px';
    }

    /* ---------------- auth ---------------- */
    function openAuth() {
        $('aUser').value = state.user;
        $('aToken').value = state.token;
        $('authWrap').hidden = false;
    }

    /* ---------------- events ---------------- */
    function wire() {
        // sidebar
        $('projects').addEventListener('click', function (e) {
            var b = e.target.closest('[data-project]');
            if (!b) return;
            localStorage.setItem('kbui.project', b.dataset.project);
            openSide(false);          // na mobitelu zatvori izbornik nakon odabira
            loadAll();
        });
        $('themeBtn').addEventListener('click', function () {
            applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
        });
        $('authBtn').addEventListener('click', openAuth);
        $('menuBtn').addEventListener('click', function () { openSide(true); });
        $('sideScrim').addEventListener('click', function () { openSide(false); });
        $('fsmenu').addEventListener('click', function (e) {
            var b = e.target.closest('[data-fs]');
            if (b) applyFs(b.dataset.fs);
        });
        $('addProjectHint').addEventListener('click', function () {
            toast('Projekte kreiraš u Kanboardu — ovo sučelje ih samo prikazuje.');
        });

        // top bar
        $('search').addEventListener('input', function (e) {
            state.search = e.target.value.trim();
            renderBoard(); renderList();
        });
        $('sortBtn').addEventListener('click', function () {
            state.sort = state.sort === 'due' ? 'priority' : 'due';
            toast('Sortiranje: ' + (state.sort === 'due' ? 'po datumu' : 'po prioritetu'));
            renderBoard(); renderList();
        });

        // views
        document.querySelector('.tabs').addEventListener('click', function (e) {
            var b = e.target.closest('.tab');
            if (!b) return;
            state.view = b.dataset.view;
            document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('is-active', x === b); });
            board.hidden = state.view === 'list';
            $('listview').hidden = state.view !== 'list';
        });

        // board: open task, add task
        board.addEventListener('click', function (e) {
            var add = e.target.closest('[data-add]');
            if (add) { newCardForm(add.dataset.add, add.closest('.col').querySelector('.cards')); return; }
            var card = e.target.closest('[data-task]');
            if (card) openTask(Number(card.dataset.task));
        });
        $('listview').addEventListener('click', function (e) {
            var row = e.target.closest('[data-task]');
            if (row) openTask(Number(row.dataset.task));
        });

        // drag & drop
        var dragId = null;
        board.addEventListener('dragstart', function (e) {
            var c = e.target.closest('.card');
            if (!c) return;
            dragId = Number(c.dataset.task);
            c.classList.add('is-dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', String(dragId));
        });
        board.addEventListener('dragend', function (e) {
            var c = e.target.closest('.card');
            if (c) c.classList.remove('is-dragging');
        });
        board.addEventListener('dragover', function (e) {
            var zone = e.target.closest('.cards');
            if (!zone) return;
            e.preventDefault();
            zone.classList.add('drag-over');
        });
        board.addEventListener('dragleave', function (e) {
            var zone = e.target.closest('.cards');
            if (zone) zone.classList.remove('drag-over');
        });
        board.addEventListener('drop', function (e) {
            var zone = e.target.closest('.cards');
            if (!zone) return;
            e.preventDefault();
            zone.classList.remove('drag-over');
            var id = Number(e.dataTransfer.getData('text/plain') || dragId);
            var colId = Number(zone.dataset.drop);
            var swimlane = Number(zone.closest('.col').dataset.swimlane);
            var pos = zone.querySelectorAll('.card').length + 1;
            api('moveTaskPosition', {
                project_id: state.project.id, task_id: id, column_id: colId,
                position: pos, swimlane_id: swimlane
            }).then(function () {
                toast('Zadatak prebačen');
                loadAll();
            }).catch(fail);
        });

        // drawer
        $('dClose').addEventListener('click', closeDrawer);
        $('scrim').addEventListener('click', closeDrawer);
        $('dTitle').addEventListener('input', function (e) { autosize(e.target); saveTask({ title: e.target.value }); });
        $('dDesc').addEventListener('change', function (e) { saveTask({ description: e.target.value }); });
        $('pDue').addEventListener('change', function (e) {
            saveTask({ date_due: e.target.value || '' });
        });
        $('pPriority').addEventListener('click', function () {
            var next = ((state.task.priority || 0) + 1) % 4;
            saveTask({ priority: next });
        });
        $('pColor').addEventListener('click', function () {
            var keys = Object.keys(COLOR_HEX);
            var i = keys.indexOf(state.task.color_id);
            saveTask({ color_id: keys[(i + 1) % keys.length] });
        });
        $('pCategory').addEventListener('click', function () {
            if (!state.categories.length) { toast('Nema kategorija u projektu.'); return; }
            var i = state.categories.map(function (c) { return c.id; }).indexOf(state.task.category_id);
            var nxt = state.categories[(i + 1) % state.categories.length];
            saveTask({ category_id: nxt.id });
        });
        $('pColumn').addEventListener('click', function () {
            var cols = [];
            state.board.forEach(function (sw) { (sw.columns || []).forEach(function (c) { cols.push(c); }); });
            var i = cols.map(function (c) { return c.id; }).indexOf(state.task.column_id);
            var nxt = cols[(i + 1) % cols.length];
            api('moveTaskPosition', {
                project_id: state.project.id, task_id: state.task.id, column_id: nxt.id,
                position: 1, swimlane_id: state.task.swimlane_id || 1
            }).then(function () { toast('Status: ' + nxt.title); loadAll(); openTask(state.task.id, true); }).catch(fail);
        });

        $('dAddSub').addEventListener('click', function () {
            var title = prompt('Naslov podzadatka:');
            if (!title) return;
            api('createSubtask', { task_id: state.task.id, title: title }).then(function () {
                openTask(state.task.id, true);
                toast('Podzadatak dodan');
            }).catch(fail);
        });
        $('dSubtasks').addEventListener('change', function (e) {
            var cb = e.target.closest('[data-sub]');
            if (!cb) return;
            api('updateSubtask', { id: Number(cb.dataset.sub), task_id: state.task.id, status: cb.checked ? 1 : 0 })
                .then(function () { openTask(state.task.id, true); }).catch(fail);
        });
        $('dCommentSend').addEventListener('click', function () {
            var ta = $('dCommentInput');
            if (!ta.value.trim()) return;
            api('getMe').then(function (me) {
                return api('createComment', { task_id: state.task.id, user_id: me.id, content: ta.value });
            }).then(function () {
                ta.value = '';
                openTask(state.task.id, true);
                toast('Komentar dodan');
            }).catch(fail);
        });
        $('dDelete').addEventListener('click', function () {
            if (!confirm('Obrisati zadatak "' + state.task.title + '"?')) return;
            api('removeTask', { task_id: state.task.id }).then(function () {
                closeDrawer(); toast('Zadatak obrisan'); loadAll();
            }).catch(fail);
        });

        // auth modal
        $('authSave').addEventListener('click', function () {
            state.user = $('aUser').value.trim() || 'admin';
            state.token = $('aToken').value.trim();
            localStorage.setItem(LS_USER, state.user);
            localStorage.setItem(LS_TOKEN, state.token);
            $('authWrap').hidden = true;
            loadAll();
        });
        $('authCancel').addEventListener('click', function () { $('authWrap').hidden = true; });
        $('authScrim').addEventListener('click', function () { $('authWrap').hidden = true; });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { closeDrawer(); $('authWrap').hidden = true; }
        });
    }

    function saveTask(patch) {
        if (!state.task) return;
        var body = Object.assign({ id: state.task.id }, patch);
        api('updateTask', body).then(function () {
            Object.assign(state.task, patch);
            if (patch.title !== undefined) { state.task.title = patch.title; }
            renderBoard(); renderList();
        }).catch(fail);
    }

    function newCardForm(columnId, container) {
        if (container.querySelector('.new-card')) return;
        var wrap = document.createElement('div');
        wrap.className = 'new-card';
        wrap.innerHTML = '<textarea rows="2" placeholder="Naslov zadatka… (Enter za spremanje)"></textarea>';
        container.appendChild(wrap);
        var ta = wrap.querySelector('textarea');
        ta.focus();
        ta.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                var title = ta.value.trim();
                if (!title) { wrap.remove(); return; }
                api('createTask', {
                    title: title, project_id: state.project.id, column_id: columnId
                }).then(function () { toast('Zadatak dodan'); loadAll(); }).catch(fail);
            }
            if (e.key === 'Escape') wrap.remove();
        });
        ta.addEventListener('blur', function () { setTimeout(function () { if (!ta.value.trim()) wrap.remove(); }, 150); });
    }

    boot();
})();
