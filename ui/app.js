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
        members: [],
        files: [],
        calMonth: null,
        filter: { owner: 0, category: 0, priority: '', due: '' },
        selected: {},
        selecting: false,
        collapsed: {},
        links: [],
        linkTypes: [],
        tlDay: 30,
        aggregate: false,
        all: [],
        readonly: false
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
            if (j.error) {
                var err = new Error(j.error.message || 'API greška');
                err.code = j.error.code;
                throw err;
            }
            return j.result;
        });
    }

    function fail(e) {
        toast('Greška: ' + (e && e.message ? e.message : e));
        console.error(e);
    }

    /* ---------------- boot ---------------- */
    // površne greške ne smiju proći nezapaženo (promise chain bez catch-a)
    window.addEventListener('unhandledrejection', function (e) {
        (window.__errs = window.__errs || []).push('rejection: ' + (e.reason && e.reason.message || e.reason));
    });

    function boot() {
        applyTheme(localStorage.getItem(LS_THEME) || 'dark');
        try { state.collapsed = JSON.parse(localStorage.getItem('kbui.collapsed') || '{}') || {}; } catch (e) { state.collapsed = {}; }
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
        return api('getVersion').then(function (v) {
            $('kbVer').textContent = /unknown|\$Format/.test(v) ? '1.2.57' : v;
            return api('getMe').then(function (me) { state.me = me; return me; }).catch(function () { return null; });
        }).then(function () {
            // getAllProjects je samo za app-admina (403 za običnog korisnika);
            // getMyProjects vraća projekte u kojima korisnik stvarno jest
            return api('getMyProjects').catch(function () { return api('getAllProjects'); });
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
                api('getProjectUsers', { project_id: state.project.id }).catch(function () { return {}; })
            ]);
        }).then(function (res) {
            state.board = res[0] || [];
            state.categories = res[1] || [];
            var u = res[2] || [];
            state.members = Array.isArray(u) ? u.map(function (x) { return x; })
                : Object.keys(u).map(function (k) { return { id: Number(k), name: u[k] }; });
            state.users = state.members;
            renderBoard();
            renderList();
            if (state.view === 'calendar') renderCalendar();
            if (state.view === 'timeline') renderTimeline();
            fillFilterSelects();
            refreshFilterBar();
            countMine();
            var firstTasks = [];
            (state.board || []).forEach(function (sw) {
                (sw.columns || []).forEach(function (c) {
                    (c.tasks || []).forEach(function (t) { if (t.is_active) firstTasks.push(t); });
                });
            });
            probePermission(firstTasks);
            loadAggregate();   // samo za broj u navigaciji
            var t = localStorage.getItem('kbui.task');
            if (t) openTask(Number(t), true);
        }).catch(function (e) {
            fail(e);
            if (!state.projects.length) openAuth();
        });
    }

    function fmtSize(b) {
        if (!b) return '0 B';
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(0) + ' kB';
        return (b / 1048576).toFixed(1) + ' MB';
    }

    function closePop() { var p = $('popmenu'); p.hidden = true; p.innerHTML = ''; }

    function openPop(anchor, items, onPick) {
        var pop = $('popmenu');
        pop.innerHTML = items.map(function (it, i) {
            return '<button data-i="' + i + '"' + (it.active ? ' class="is-active"' : '') + '>' +
                (it.dot ? '<span class="dot" style="background:' + it.dot + '"></span>' : '') +
                esc(it.label) + (it.meta ? '<span class="who">' + esc(it.meta) + '</span>' : '') + '</button>';
        }).join('');
        pop.hidden = false;
        var r = anchor.getBoundingClientRect();
        var w = Math.max(176, r.width);
        pop.style.minWidth = w + 'px';
        var left = Math.min(r.left, window.innerWidth - w - 8);
        var top = r.bottom + 4;
        if (top + pop.offsetHeight > window.innerHeight - 8) {
            top = Math.max(8, r.top - pop.offsetHeight - 4);
        }
        pop.style.left = Math.max(8, left) + 'px';
        pop.style.top = top + 'px';
        pop.onclick = function (e) {
            var b = e.target.closest('[data-i]');
            if (!b) return;
            closePop();
            onPick(items[Number(b.dataset.i)]);
        };
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

        var picked = !!state.selected[t.id];
        return '<article class="card' + (picked ? ' is-picked' : '') + '" draggable="' + (state.selecting ? 'false' : 'true') + '" data-task="' + t.id + '">' +
            '<div class="card-top">' +
            (state.selecting ? '<input type="checkbox" class="pick" data-pick="' + t.id + '"' + (picked ? ' checked' : '') + '>' : '') +
            '<span class="card-id">' + esc(id) + '</span>' +
            (av ? '<span class="assignee" title="' + esc(who) + '">' + av + '</span>' : '') +
            '</div>' +
            '<div class="card-title">' + esc(t.title) + '</div>' +
            (meta ? '<div class="card-meta">' + meta + '</div>' : '') +
            (labels ? '<div class="card-labels">' + labels + '</div>' : '') +
            '</article>';
    }

    function dueBucket(t) {
        if (!t.date_due) return 'none';
        var info = dueInfo(t.date_due);
        if (!info) return 'none';
        if (info.overdue) return 'over';
        if (info.text === 'danas') return 'today';
        var d = new Date(t.date_due * 1000), now = new Date();
        var diff = (d - now) / 86400000;
        return diff <= 7 ? 'week' : 'later';
    }

    function visible(t) {
        var f = state.filter;
        if (f.owner && t.owner_id !== f.owner) return false;
        if (f.category && t.category_id !== f.category) return false;
        if (f.priority !== '' && (t.priority || 0) !== Number(f.priority)) return false;
        if (f.due) {
            var b = dueBucket(t);
            if (f.due === 'week' ? (b !== 'week' && b !== 'today') : b !== f.due) return false;
        }
        if (!state.search) return true;
        var q = state.search.toLowerCase();
        return (t.title || '').toLowerCase().indexOf(q) > -1 ||
            (t.category_name || '').toLowerCase().indexOf(q) > -1 ||
            (t.assignee_name || '').toLowerCase().indexOf(q) > -1;
    }

    function activeFilterCount() {
        var f = state.filter, n = 0;
        if (f.owner) n++;
        if (f.category) n++;
        if (f.priority !== '') n++;
        if (f.due) n++;
        return n;
    }

    function refreshFilterBar() {
        var n = activeFilterCount();
        $('filterCount').textContent = n ? ' · ' + n : '';
        $('filterBtn').classList.toggle('has-filter', n > 0);
    }

    function applyFilters() {
        renderBoard();
        renderList();
        if (state.view === 'calendar') renderCalendar();
        if (state.view === 'timeline') renderTimeline();
        if (state.aggregate) renderAggregate();
        refreshFilterBar();
        renderBulkBar();
    }

    // prikaz: agregat sakriva ploču/listu/kalendar/crtu i obrnuto
    function showAggregate(on) {
        state.aggregate = !!on;
        $('aggview').hidden = !state.aggregate;
        board.hidden = state.aggregate || state.view !== 'board';
        $('listview').hidden = state.aggregate || state.view !== 'list';
        $('calendar').hidden = state.aggregate || state.view !== 'calendar';
        $('timeline').hidden = state.aggregate || state.view !== 'timeline';
        document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('is-disabled', state.aggregate); });
        if (state.aggregate) loadAggregate();
        else if (state.view === 'calendar') renderCalendar();
        else if (state.view === 'timeline') renderTimeline();
    }

    function pickedIds() {
        return Object.keys(state.selected).filter(function (k) { return state.selected[k]; }).map(Number);
    }

    function togglePick(id) {
        state.selected[id] = !state.selected[id];
        renderBoard();
        renderBulkBar();
    }

    function renderBulkBar() {
        var n = pickedIds().length;
        $('bulkbar').hidden = !(state.selecting && n > 0);
        $('bulkCount').textContent = n + ' odabrano';
    }

    function bulk(fn, msg) {
        var ids = pickedIds();
        var tasks = [];
        allTasks().forEach(function (t) { if (ids.indexOf(t.id) > -1) tasks.push(t); });
        if (!tasks.length) { toast('Nema odabranih zadataka'); return; }
        var ok = 0, bad = 0, left = tasks.length;
        tasks.forEach(function (t) {
            fn(t).then(function () { ok++; }).catch(function () { bad++; }).then(function () {
                if (--left > 0) return;
                toast(msg + ' (' + ok + (bad ? ', greške: ' + bad : '') + ')');
                state.selected = {};
                state.selecting = false;
                document.body.classList.remove('selecting');
                $('selectBtn').classList.remove('has-filter');
                loadAll();
            });
        });
    }

    function fillFilterSelects() {
        var f = state.filter;
        var owner = $('fOwner');
        owner.innerHTML = '<option value="0">svi</option>' + state.members.map(function (m) {
            return '<option value="' + m.id + '">' + esc(m.name) + '</option>';
        }).join('');
        owner.value = String(f.owner || 0);

        var cat = $('fCategory');
        cat.innerHTML = '<option value="0">sve</option>' + (state.categories || []).map(function (c) {
            return '<option value="' + c.id + '">' + esc(c.name) + '</option>';
        }).join('');
        cat.value = String(f.category || 0);

        $('fPriority').value = f.priority;
        $('fDue').value = f.due;
        $('fSort').value = state.sort;
    }

    function columnsHTML(sw, baseIndex) {
        var html = '';
        (sw.columns || []).forEach(function (c, i) {
            var tasks = sortTasks((c.tasks || []).filter(function (t) { return t.is_active && visible(t); }));
            sw.__count = (sw.__count || 0) + tasks.length;
            var over = c.task_limit && tasks.length > c.task_limit;
            html += '<section class="col" data-swimlane="' + sw.id + '" data-column="' + c.id + '">' +
                '<header class="col-head">' +
                '<span class="col-dot">' + (COL_ICON[(baseIndex + i) % COL_ICON.length]) + '</span>' +
                '<span class="col-title">' + esc(c.title) + '</span>' +
                '<span class="col-num"' + (over ? ' style="color:var(--danger)" title="Preko limita kolone"' : '') + '>' + tasks.length + '</span>' +
                '<button class="icon-btn sm" data-add="' + c.id + '" title="Novi zadatak">+</button>' +
                '</header>' +
                '<div class="cards" data-drop="' + c.id + '">' + tasks.map(cardHTML).join('') + '</div>' +
                '</section>';
        });
        return html;
    }

    function renderBoard() {
        var lanes = (state.board || []).filter(function (sw) { return (sw.columns || []).length; });
        if (!lanes.length) { board.innerHTML = '<div class="col"><div class="empty">Projekt nema kolona.</div></div>'; return; }

        var multi = lanes.length > 1;
        var total = 0;
        board.innerHTML = lanes.map(function (sw, li) {
            sw.__count = 0;
            var coll = !!state.collapsed[sw.id];
            var cols = columnsHTML(sw, li);
            total += sw.__count;
            return '<section class="swimlane' + (coll ? ' is-collapsed' : '') + '" data-swimlane="' + sw.id + '">' +
                (multi
                    ? '<header class="swimlane-head">' +
                      '<button class="sw-btn" data-collapse="' + sw.id + '" title="Sklopi/raširi stazu">' + (coll ? '▸' : '▾') + '</button>' +
                      '<span class="sw-name">' + esc(sw.name) + '</span>' +
                      '<span class="col-num">' + sw.__count + '</span>' +
                      '</header>'
                    : '') +
                '<div class="board-row">' + cols + '</div>' +
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
            $('pOwner').textContent = ownerName(t.owner_id) || 'nitko';
            $('drawerWrap').hidden = false;
            autosize($('dTitle'));
            return Promise.all([
                api('getAllSubtasks', { task_id: t.id }).catch(function () { return []; }),
                api('getAllComments', { task_id: t.id }).catch(function () { return []; }),
                api('getAllTaskFiles', { task_id: t.id }).catch(function () { return []; }),
                api('getAllTaskLinks', { task_id: t.id }).catch(function () { return []; }),
                state.linkTypes.length ? Promise.resolve(state.linkTypes) : api('getAllLinks').catch(function () { return []; })
            ]);
        }).then(function (res) {
            renderSubtasks(res[0] || []);
            renderComments(res[1] || []);
            renderFiles(res[2] || []);
            state.linkTypes = res[4] || [];
            renderLinks(res[3] || []);
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

    /* ---------------- attachments ---------------- */
    function renderFiles(list) {
        state.files = list || [];
        $('dFileCount').textContent = list.length ? list.length : '';
        $('dFiles').innerHTML = list.map(function (f) {
            return '<div class="file-row" data-file="' + f.id + '">' +
                '<span class="fi">' + (f.is_image == 1 ? '🖼' : '📄') + '</span>' +
                '<span class="fname" data-dl="' + f.id + '" title="Preuzmi">' + esc(f.name) + '</span>' +
                '<span class="fsize">' + fmtSize(f.size) + '</span>' +
                '<button class="icon-btn sm" data-del="' + f.id + '" title="Obriši privitak">✕</button>' +
                '</div>';
        }).join('') || '<div class="muted" style="font-size:.8rem;padding:.2rem .1rem">Nema privitaka.</div>';
    }

    function uploadFiles(fileList) {
        if (!fileList || !fileList.length || !state.task) return;
        var pending = fileList.length;
        Array.prototype.forEach.call(fileList, function (file) {
            var fr = new FileReader();
            fr.onload = function () {
                var b64 = String(fr.result).split(',')[1] || '';
                api('createTaskFile', {
                    project_id: state.project.id, task_id: state.task.id,
                    filename: file.name, blob: b64,
                    is_image: /^image\//.test(file.type) ? 1 : 0
                }).then(function () {
                    if (--pending === 0) { toast('Privici dodani'); openTask(state.task.id, true); loadAll(); }
                }).catch(function (e) { fail(e); });
            };
            fr.readAsDataURL(file);
        });
    }

    function downloadFile(id) {
        var f = state.files.filter(function (x) { return x.id === id; })[0];
        api('downloadTaskFile', { file_id: id }).then(function (b64) {
            var bin = atob(b64);
            var bytes = new Uint8Array(bin.length);
            for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            var url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
            var a = document.createElement('a');
            a.href = url; a.download = f ? f.name : ('file-' + id);
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        }).catch(fail);
    }

    function removeFile(id) {
        if (!confirm('Obrisati privitak?')) return;
        api('removeTaskFile', { file_id: id }).then(function () {
            toast('Privitak obrisan'); openTask(state.task.id, true); loadAll();
        }).catch(fail);
    }

    function openInProject(projectId, taskId) {
        if (state.project && state.project.id === projectId) { openTask(taskId); return; }
        localStorage.setItem('kbui.project', projectId);
        showAggregate(false);
        Promise.resolve(loadAll()).then(function () { openTask(taskId); }).catch(fail);
    }

    /* ---------------- aggregate (all projects) ---------------- */
    function loadAggregate() {
        $('aggList').innerHTML = '<div class="empty">Učitavam sve projekte…</div>';
        var projects = state.projects || [];
        return Promise.all(projects.map(function (p) {
            return Promise.all([
                api('getAllTasks', { project_id: p.id, status_id: 1 }).catch(function () { return []; }),
                api('getColumns', { project_id: p.id }).catch(function () { return []; }),
                api('getAllCategories', { project_id: p.id }).catch(function () { return []; })
            ]).then(function (r) {
                var colName = {}, catName = {}, catColor = {};
                (r[1] || []).forEach(function (c) { colName[c.id] = c.title; });
                (r[2] || []).forEach(function (c) { catName[c.id] = c.name; catColor[c.id] = c.color_id; });
                return (r[0] || []).map(function (t) {
                    t.column_name = colName[t.column_id] || '';
                    t.category_name = catName[t.category_id] || '';
                    t.category_color_id = catColor[t.category_id] || '';
                    return { t: t, p: p };
                });
            }).catch(function () { return []; });
        })).then(function (chunks) {
            var flat = [];
            chunks.forEach(function (c) { flat = flat.concat(c); });
            state.all = flat;
            renderAggregate();
        }).catch(fail);
    }

    function aggVisible(t) {
        if (state.filter.owner && t.owner_id !== state.filter.owner) return false;
        if (state.filter.priority && String(t.priority) !== String(state.filter.priority)) return false;
        if (state.filter.due) {
            var b = dueBucket(t);
            if (state.filter.due === 'none' ? b !== 'none' : b !== state.filter.due) return false;
        }
        var q = (state.search || '').toLowerCase();
        if (q && (t.title || '').toLowerCase().indexOf(q) === -1 &&
            String(t.id).indexOf(q) === -1 && (t.category_name || '').toLowerCase().indexOf(q) === -1) return false;
        return true;
    }

    function renderAggregate() {
        var rows = state.all.filter(function (x) { return aggVisible(x.t); });
        $('allCount').textContent = state.all.length;
        var groups = {};
        var order = [];
        rows.forEach(function (x) {
            var k = x.p.id;
            if (!groups[k]) { groups[k] = { project: x.p, rows: [] }; order.push(k); }
            groups[k].rows.push(x.t);
        });
        $('aggList').innerHTML = order.map(function (k) {
            var g = groups[k];
            g.rows.sort(function (a, b) {
                var ad = a.date_due || 9e12, bd = b.date_due || 9e12;
                return ad - bd;
            });
            var open = g.rows.length;
            return '<div class="agg-proj"><span class="pcode">' + esc(ref(g.project)) + '</span>' + esc(g.project.name) +
                '<span class="col-num">' + open + '</span></div>' +
                g.rows.map(function (t) {
                    var due = dueInfo(t.date_due);
                    var id = t.reference || (ref(g.project) + '-' + t.id);
                    return '<div class="agg-row" data-task="' + t.id + '" data-project="' + g.project.id + '">' +
                        '<span class="card-id">' + esc(id) + '</span>' +
                        '<span class="agg-title">' + esc(t.title) + '</span>' +
                        (t.column_name ? '<span class="agg-col">' + esc(t.column_name) + '</span>' : '') +
                        (due ? '<span class="chip mono' + (due.overdue ? ' due-over' : due.soon ? ' due-soon' : '') + '">' + ICO.due + ' ' + due.text + '</span>' : '') +
                        (t.category_name ? '<span class="chip"><span class="dot" style="background:' + (COLOR_HEX[t.category_color_id] || 'var(--text-3)') + '"></span>' + esc(t.category_name) + '</span>' : '') +
                        '</div>';
                }).join('');
        }).join('') || '<div class="empty">Nema zadataka za ovaj filtar.</div>';
        $('aggInfo').textContent = rows.length + ' zadataka u ' + order.length + ' projekata';
    }

    function csvCell(v) {
        v = (v === null || v === undefined) ? '' : String(v);
        return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }

    function exportCSV() {
        var rows = [];
        var head = ['Projekt', 'ID', 'Naslov', 'Kolona', 'Dodijeljeno', 'Rok', 'Prioritet', 'Kategorija', 'Opis'];
        var data = [];
        if (state.aggregate) {
            state.all.forEach(function (x) {
                if (!aggVisible(x.t)) return;
                data.push([x.p.name, x.t.reference || (ref(x.p) + '-' + x.t.id), x.t.title, x.t.column_name,
                    ownerName(x.t.owner_id), prettyDate(x.t.date_due), x.t.priority, x.t.category_name, x.t.description]);
            });
        } else {
            var cols = [];
            (state.board || []).forEach(function (sw) { (sw.columns || []).forEach(function (c) { cols.push(c); }); });
            cols.forEach(function (c) {
                (c.tasks || []).filter(function (t) { return t.is_active && visible(t); }).forEach(function (t) {
                    data.push([state.project.name, t.reference || (ref(state.project) + '-' + t.id), t.title, c.title,
                        ownerName(t.owner_id), prettyDate(t.date_due), t.priority, t.category_name, '']);
                });
            });
        }
        if (!data.length) { toast('Nema zadataka za izvoz.'); return; }
        var csv = [head].concat(data).map(function (r) { return r.map(csvCell).join(';'); }).join('\r\n');
        var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'kanban-' + (state.aggregate ? 'svi-projekti' : ref(state.project)) + '-' + new Date().toISOString().slice(0, 10) + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        toast('Izvezeno ' + data.length + ' zadataka');
    }

    /* ---------------- read-only (project role) ---------------- */
    function setReadonly(on) {
        state.readonly = !!on;
        document.body.classList.toggle('is-readonly', state.readonly);
        $('robar').hidden = !state.readonly;
    }

    // Uloga na projektu nije u JSON-RPC odgovoru (getProjectUsers vraća samo imena),
    // pa je provjerimo jednim bezopasnim upisom iste vrijednosti: ako ga Kanboard
    // odbije, korisnik je gledatelj.
    function probePermission(tasks) {
        var first = (tasks || [])[0];
        if (!first) { setReadonly(false); return Promise.resolve(); }
        if (state.me && state.me.role === 'app-admin') { setReadonly(false); return Promise.resolve(); }
        return api('updateTask', { id: first.id, title: first.title }).then(function () {
            setReadonly(false);
        }).catch(function (e) {
            var msg = (e && e.message) || '';
            // Kanboard za nedovoljna prava vraća 403 "Forbidden"
            setReadonly(e && e.code === 403 || /not allowed|permission|dopu|denied|forbidden/i.test(msg));
        });
    }

    /* ---------------- related tasks ---------------- */
    function renderLinks(list) {
        state.links = list || [];
        $('dLinkCount').textContent = list.length ? list.length : '';
        $('dLinks').innerHTML = list.map(function (l) {
            return '<div class="link-row">' +
                '<span class="lkind">' + esc(l.label) + '</span>' +
                '<span class="lname" data-open="' + l.task_id + '">' + esc(l.title || '') + '</span>' +
                '<span class="lref">' + esc(ref(state.project) + '-' + l.task_id) + '</span>' +
                '<button class="icon-btn sm" data-unlink="' + l.id + '" title="Ukloni vezu">✕</button>' +
                '</div>';
        }).join('') || '<div class="muted" style="font-size:.8rem;padding:.2rem .1rem">Nema veza.</div>';
    }

    function addLink() {
        var types = (state.linkTypes || []);
        if (!types.length) { toast('Kanboard ne vraća tipove veza.'); return; }
        openPop($('dAddLink'), types.map(function (t) { return { label: t.label, value: t.id }; }), function (type) {
            var others = allTasks().filter(function (t) { return t.id !== state.task.id; });
            if (!others.length) { toast('Nema drugih zadataka u projektu.'); return; }
            openPop($('dAddLink'), others.map(function (t) {
                return { label: t.title, meta: ref(state.project) + '-' + t.id, value: t.id };
            }), function (pick) {
                api('createTaskLink', { task_id: state.task.id, opposite_task_id: pick.value, link_id: type.value })
                    .then(function () { toast('Veza dodana'); openTask(state.task.id, true); })
                    .catch(fail);
            });
        });
    }

    function unlink(linkId) {
        api('removeTaskLink', { task_link_id: linkId }).then(function () {
            toast('Veza uklonjena'); openTask(state.task.id, true);
        }).catch(fail);
    }

    /* ---------------- timeline ---------------- */
    function dayKey(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }

    function renderTimeline() {
        var host = $('tlScroll');
        var list = allTasks().filter(visible);
        var dated = list.filter(function (t) { return t.date_due; });
        if (!dated.length) {
            host.innerHTML = '<div class="tl-empty">Nema zadataka s rokom u ovom projektu (ili ih filtri skrivaju).</div>';
            $('tlRange').textContent = '';
            return;
        }

        var min = null, max = null;
        dated.forEach(function (t) {
            var s = dayKey(new Date(((t.date_started || t.date_creation) * 1000)));
            var e = dayKey(new Date(t.date_due * 1000));
            if (e < s) e = s;
            if (min === null || s < min) min = s;
            if (max === null || e > max) max = e;
        });
        var today = dayKey(new Date());
        if (today < min) min = today;
        if (today > max) max = today;
        // pad to whole weeks
        var start = dayKey(new Date(min)); start -= new Date(start).getDay() * 86400000;
        var end = max + 7 * 86400000;
        var days = Math.round((end - start) / 86400000);
        var W = state.tlDay;
        var totalW = days * W;

        var months = [], curMonth = null;
        var daysHTML = '';
        for (var i = 0; i < days; i++) {
            var d = new Date(start + i * 86400000);
            var mk = d.getFullYear() + '-' + d.getMonth();
            if (mk !== curMonth) {
                months.push({ label: d.toLocaleDateString('hr-HR', { month: 'short', year: '2-digit' }), n: 1 });
                curMonth = mk;
            } else {
                months[months.length - 1].n++;
            }
            var wknd = d.getDay() === 0 || d.getDay() === 6;
            daysHTML += '<div class="tl-day' + (wknd ? ' is-weekend' : '') + (dayKey(d) === today ? ' is-today' : '') +
                '" style="width:' + W + 'px">' + d.getDate() + '</div>';
        }
        var monthsHTML = months.map(function (m) {
            return '<div class="tl-month" style="width:' + (m.n * W) + 'px">' + esc(m.label) + '</div>';
        }).join('');

        var groups = [];
        state.board.forEach(function (sw) {
            (sw.columns || []).forEach(function (c) {
                var tasks = dated.filter(function (t) { return t.column_id === c.id; });
                if (tasks.length) groups.push({ title: c.title, tasks: sortTasks(tasks) });
            });
        });

        var rowsHTML = groups.map(function (g) {
            return '<div class="tl-group-head">' + esc(g.title) + '</div>' + g.tasks.map(function (t) {
                var s = dayKey(new Date(((t.date_started || t.date_creation) * 1000)));
                var e = dayKey(new Date(t.date_due * 1000));
                if (e < s) e = s;
                var left = ((s - start) / 86400000) * W;
                var width = Math.max(W, ((e - s) / 86400000 + 1) * W);
                var due = dueInfo(t.date_due);
                var col = COLOR_HEX[t.color_id] || '#8a8f98';
                return '<div class="tl-row">' +
                    '<div class="tl-label" data-task="' + t.id + '">' +
                    '<span class="lref">' + esc(ref(state.project) + '-' + t.id) + '</span>' +
                    '<span>' + esc(t.title) + '</span></div>' +
                    '<div class="tl-track" style="width:' + totalW + 'px">' +
                    '<div class="tl-bar' + (due && due.overdue ? ' is-overdue' : '') + '" data-task="' + t.id + '"' +
                    ' style="left:' + left + 'px;width:' + width + 'px;background:' + col + '"' +
                    ' title="' + esc(prettyDate(t.date_started || t.date_creation) + ' → ' + prettyDate(t.date_due)) + '"></div>' +
                    (dayKey(new Date(today)) >= start && today <= end
                        ? '<div class="tl-today" style="left:' + (((today - start) / 86400000) * W) + 'px"></div>' : '') +
                    '</div></div>';
            }).join('');
        }).join('');

        var todayX = ((today - start) / 86400000) * W;
        host.innerHTML =
            '<div class="tl-head"><div class="tl-corner"></div><div>' +
                '<div class="tl-months">' + monthsHTML + '</div>' +
                '<div class="tl-days">' + daysHTML + '</div>' +
            '</div></div>' + rowsHTML;

        $('tlRange').textContent = prettyDate(start / 1000) + ' – ' + prettyDate(end / 1000);
        // skrolaj na danas
        setTimeout(function () {
            host.scrollLeft = Math.max(0, todayX - host.clientWidth / 3);
        }, 30);
    }

    function prettyDate(ts) {
        if (!ts) return '—';
        return new Date(ts * 1000).toLocaleDateString('hr-HR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    /* ---------------- calendar ---------------- */
    function renderCalendar() {
        if (!state.calMonth) { var n = new Date(); state.calMonth = new Date(n.getFullYear(), n.getMonth(), 1); }
        var m = state.calMonth;
        $('calTitle').textContent = m.toLocaleDateString('hr-HR', { month: 'long', year: 'numeric' });
        var first = new Date(m.getFullYear(), m.getMonth(), 1);
        var start = new Date(first);
        start.setDate(1 - ((first.getDay() + 6) % 7));            // ponedjeljak prvi
        var today = new Date(); today.setHours(0, 0, 0, 0);

        var byDay = {};
        allTasks().forEach(function (t) {
            if (!t.date_due) return;
            var d = new Date(t.date_due * 1000);
            var key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
            (byDay[key] = byDay[key] || []).push(t);
        });

        var html = ['Pon', 'Uto', 'Sri', 'Čet', 'Pet', 'Sub', 'Ned']
            .map(function (d) { return '<div class="cal-dow">' + d + '</div>'; }).join('');

        for (var i = 0; i < 42; i++) {
            var day = new Date(start); day.setDate(start.getDate() + i);
            var key = day.getFullYear() + '-' + day.getMonth() + '-' + day.getDate();
            var list = (byDay[key] || []).filter(visible);
            var cls = 'cal-day';
            if (day.getMonth() !== m.getMonth()) cls += ' is-out';
            if (day.getTime() === today.getTime()) cls += ' is-today';
            html += '<div class="' + cls + '"><div class="cal-num">' + day.getDate() + '</div>' +
                list.map(function (t) {
                    return '<div class="cal-task' + (t.column_id === lastColumnId() ? ' is-done' : '') + '" data-task="' + t.id + '"' +
                        ' title="' + esc(t.title) + '"><span>' + esc(t.title) + '</span></div>';
                }).join('') + '</div>';
        }
        $('calGrid').innerHTML = html;
    }

    function lastColumnId() {
        var ids = [];
        state.board.forEach(function (sw) { (sw.columns || []).forEach(function (c) { ids.push(c.id); }); });
        return ids[ids.length - 1];
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
        $('printBtn').addEventListener('click', function () { window.print(); });
        $('aggExport').addEventListener('click', exportCSV);
        $('aggList').addEventListener('click', function (e) {
            var row = e.target.closest('[data-task]');
            if (!row) return;
            var pid = Number(row.dataset.project);
            openInProject(pid, Number(row.dataset.task));
        });
        $('addProjectHint').addEventListener('click', function () {
            toast('Projekte kreiraš u Kanboardu — ovo sučelje ih samo prikazuje.');
        });

        // --- filtri ---
        $('filterBtn').addEventListener('click', function (e) {
            e.stopPropagation();
            fillFilterSelects();
            $('fpanel').hidden = !$('fpanel').hidden;
        });
        $('fClose').addEventListener('click', function () { $('fpanel').hidden = true; });
        $('fClear').addEventListener('click', function () {
            state.filter = { owner: 0, category: 0, priority: '', due: '' };
            fillFilterSelects(); applyFilters();
        });
        [['fOwner', 'owner', Number], ['fCategory', 'category', Number],
         ['fPriority', 'priority', String], ['fDue', 'due', String]].forEach(function (row) {
            $(row[0]).addEventListener('change', function (e) {
                state.filter[row[1]] = row[2](e.target.value);
                applyFilters();
            });
        });
        $('fSort').addEventListener('change', function (e) {
            state.sort = e.target.value;
            renderBoard(); renderList();
        });

        // --- masovne akcije ---
        $('selectBtn').addEventListener('click', function () {
            state.selecting = !state.selecting;
            if (!state.selecting) state.selected = {};
            document.body.classList.toggle('selecting', state.selecting);
            $('selectBtn').classList.toggle('has-filter', state.selecting);
            renderBoard(); renderBulkBar();
        });
        $('bulkCancel').addEventListener('click', function () {
            state.selecting = false; state.selected = {};
            document.body.classList.remove('selecting');
            $('selectBtn').classList.remove('has-filter');
            renderBoard(); renderBulkBar();
        });
        $('bulkMove').addEventListener('click', function () {
            var cols = [];
            state.board.forEach(function (sw) { (sw.columns || []).forEach(function (c) { cols.push(c); }); });
            openPop($('bulkMove'), cols.map(function (c) { return { label: c.title, value: c.id }; }), function (it) {
                bulk(function (t) {
                    return api('moveTaskPosition', {
                        project_id: state.project.id, task_id: t.id, column_id: it.value,
                        position: 1, swimlane_id: t.swimlane_id || 1
                    });
                }, 'Premješteno u „' + it.label + '"');
            });
        });
        $('bulkAssign').addEventListener('click', function () {
            var items = [{ label: 'nitko', value: 0 }].concat(state.members.map(function (m) {
                return { label: m.name, meta: initials(m.name), value: m.id };
            }));
            openPop($('bulkAssign'), items, function (it) {
                bulk(function (t) { return api('updateTask', { id: t.id, owner_id: it.value }); },
                    'Dodijeljeno: ' + it.label);
            });
        });
        $('bulkDelete').addEventListener('click', function () {
            var n = Object.keys(state.selected).length;
            if (!n || !confirm('Obrisati ' + n + ' zadataka?')) return;
            bulk(function (t) { return api('removeTask', { task_id: t.id }); }, 'Obrisano zadataka: ' + n);
        });

        // --- navigacija ---
        document.querySelector('.nav').addEventListener('click', function (e) {
            var item = e.target.closest('[data-nav]');
            if (!item) return;
            e.preventDefault();
            var nav = item.dataset.nav;
            document.querySelectorAll('.nav-item').forEach(function (x) { x.classList.remove('is-active'); });
            item.classList.add('is-active');

            if (nav === 'all') {
                showAggregate(true);
                applyFilters();
                return;
            }
            if (state.aggregate) showAggregate(false);

            if (nav === 'home') {
                state.filter = { owner: 0, category: 0, priority: '', due: '' };
                state.search = ''; $('search').value = '';
                applyFilters();
            } else if (nav === 'board') {
                state.view = 'board';
                applyFilters();
            } else if (nav === 'mine') {
                state.filter = { owner: (state.me && state.me.id) || 1, category: 0, priority: '', due: '' };
                applyFilters();
                toast('Prikazujem samo tvoje zadatke');
            } else if (nav === 'members') {
                var items = state.members.map(function (m) {
                    var n = allTasks().filter(function (t) { return t.owner_id === m.id; }).length;
                    return { label: m.name, meta: n + ' zad.' };
                });
                if (!items.length) { toast('Nema članova na projektu.'); return; }
                openPop(item, items, function () {});
                return;
            }
        });

        // top bar
        $('search').addEventListener('input', function (e) {
            state.search = e.target.value.trim();
            renderBoard(); renderList();
            if (state.aggregate) renderAggregate();
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
            if (state.aggregate) showAggregate(false);
            state.view = b.dataset.view;
            document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('is-active', x === b); });
            board.hidden = state.view !== 'board';
            $('listview').hidden = state.view !== 'list';
            $('calendar').hidden = state.view !== 'calendar';
            $('timeline').hidden = state.view !== 'timeline';
            if (state.view === 'calendar') renderCalendar();
            if (state.view === 'timeline') renderTimeline();
        });

        // board: open task, add task
        board.addEventListener('click', function (e) {
            var col = e.target.closest('[data-collapse]');
            if (col) {
                var id = Number(col.dataset.collapse);
                state.collapsed[id] = !state.collapsed[id];
                try { localStorage.setItem('kbui.collapsed', JSON.stringify(state.collapsed)); } catch (err) {}
                renderBoard();
                return;
            }
            var add = e.target.closest('[data-add]');
            if (add && !state.selecting) { newCardForm(add.dataset.add, add.closest('.col').querySelector('.cards')); return; }
            var card = e.target.closest('[data-task]');
            if (!card) return;
            if (state.selecting) { togglePick(Number(card.dataset.task)); return; }
            openTask(Number(card.dataset.task));
        });
        $('listview').addEventListener('click', function (e) {
            var row = e.target.closest('[data-task]');
            if (row) openTask(Number(row.dataset.task));
        });
        $('calPrev').addEventListener('click', function () {
            state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() - 1, 1); renderCalendar();
        });
        $('calNext').addEventListener('click', function () {
            state.calMonth = new Date(state.calMonth.getFullYear(), state.calMonth.getMonth() + 1, 1); renderCalendar();
        });
        $('calToday').addEventListener('click', function () {
            var n = new Date(); state.calMonth = new Date(n.getFullYear(), n.getMonth(), 1); renderCalendar();
        });
        $('calGrid').addEventListener('click', function (e) {
            var t = e.target.closest('[data-task]');
            if (t) openTask(Number(t.dataset.task));
        });
        $('tlZoomIn').addEventListener('click', function () {
            state.tlDay = Math.min(64, state.tlDay + 10); renderTimeline();
        });
        $('tlZoomOut').addEventListener('click', function () {
            state.tlDay = Math.max(14, state.tlDay - 10); renderTimeline();
        });
        $('tlToday').addEventListener('click', function () {
            var host = $('tlScroll');
            var marker = host.querySelector('.tl-days .is-today');
            if (marker) host.scrollLeft = Math.max(0, marker.offsetLeft - host.clientWidth / 3);
        });
        $('tlScroll').addEventListener('click', function (e) {
            var t = e.target.closest('[data-task]');
            if (t) openTask(Number(t.dataset.task));
        });

        // drag & drop
        var dragId = null;
        board.addEventListener('dragstart', function (e) {
            var c = e.target.closest('.card');
            if (!c) return;
            if (state.selecting || state.readonly) { e.preventDefault(); return; }
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
            openPop($('pPriority'), PRIORITY.map(function (p, i) {
                return { label: p, active: (state.task.priority || 0) === i, value: i };
            }), function (it) { saveTask({ priority: it.value }); });
        });

        $('pOwner').addEventListener('click', function () {
            var items = [{ label: 'nitko', active: !state.task.owner_id, value: 0 }].concat(
                state.members.map(function (m) {
                    return { label: m.name, meta: initials(m.name), active: state.task.owner_id === m.id, value: m.id };
                }));
            if (!state.members.length) { toast('Nema članova na projektu.'); return; }
            openPop($('pOwner'), items, function (it) { saveTask({ owner_id: it.value }).then(function () { openTask(state.task.id, true); }); });
        });
        $('pColor').addEventListener('click', function () {
            openPop($('pColor'), Object.keys(COLOR_HEX).map(function (k) {
                return { label: k, dot: COLOR_HEX[k], active: state.task.color_id === k, value: k };
            }), function (it) { saveTask({ color_id: it.value }).then(function () { openTask(state.task.id, true); }); });
        });
        $('pCategory').addEventListener('click', function () {
            var items = [{ label: 'bez kategorije', active: !state.task.category_id, value: 0 }].concat(
                (state.categories || []).map(function (c) {
                    return { label: c.name, dot: COLOR_HEX[c.color_id] || '#888', active: state.task.category_id === c.id, value: c.id };
                }));
            openPop($('pCategory'), items, function (it) { saveTask({ category_id: it.value }).then(function () { openTask(state.task.id, true); }); });
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
        $('dCommentInput').addEventListener('keyup', function (e) {
            if (e.key === 'Escape') { closePop(); return; }
            var m = /@([^\s@]*)$/.exec(e.target.value.slice(0, e.target.selectionStart));
            if (!m) { if (!$('popmenu').hidden) closePop(); return; }
            var q = m[1].toLowerCase();
            var hits = state.members.filter(function (u) { return u.name.toLowerCase().indexOf(q) === 0; });
            if (!hits.length) { closePop(); return; }
            openPop(e.target, hits.map(function (u) { return { label: u.name, meta: '@' + u.name, value: u.name }; }),
                function (it) {
                    var ta = $('dCommentInput');
                    var pos = ta.selectionStart;
                    ta.value = ta.value.slice(0, pos).replace(/@([^\s@]*)$/, '@' + it.value + ' ') + ta.value.slice(pos);
                    ta.focus();
                });
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
        $('dAddLink').addEventListener('click', addLink);
        $('dLinks').addEventListener('click', function (e) {
            var un = e.target.closest('[data-unlink]');
            if (un) { unlink(Number(un.dataset.unlink)); return; }
            var op = e.target.closest('[data-open]');
            if (op) openTask(Number(op.dataset.open));
        });
        $('dFileInput').addEventListener('change', function (e) { uploadFiles(e.target.files); e.target.value = ''; });
        $('dFiles').addEventListener('click', function (e) {
            var dl = e.target.closest('[data-dl]');
            if (dl) { downloadFile(Number(dl.dataset.dl)); return; }
            var del = e.target.closest('[data-del]');
            if (del) removeFile(Number(del.dataset.del));
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
            var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);

            if (e.key === 'Escape') {
                if (!$('popmenu').hidden) { closePop(); return; }
                closeDrawer();
                $('authWrap').hidden = true;
                $('sideScrim').hidden = true;
                document.querySelector('.side').classList.remove('is-open');
                if (typing) document.activeElement.blur();
                return;
            }
            if (typing) return;

            if (e.key === '/') { e.preventDefault(); $('search').focus(); return; }
            if (e.key === 'p') { window.print(); return; }
            if (e.key === 't') { applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); return; }
            if (e.key === 'n') {
                e.preventDefault();
                if (state.readonly) { toast('Samo gledanje — nemaš pravo dodavati zadatke.'); return; }
                var first = document.querySelector('.cards');
                if (first) newCardForm(first.dataset.drop, first);
                return;
            }
            if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4' || e.key === '5') {
                var order = ['board', 'list', 'backlog', 'calendar', 'timeline'];
                var tab = document.querySelector('.tab[data-view="' + order[Number(e.key) - 1] + '"]');
                if (tab) tab.click();
            }
        });

        document.addEventListener('mousedown', function (e) {
            var pop = $('popmenu');
            if (!pop.hidden && !e.target.closest('#popmenu') && !e.target.closest('.chip')) closePop();
        });
        window.addEventListener('scroll', function () { if (!$('popmenu').hidden) closePop(); }, true);
    }

    function saveTask(patch) {
        if (!state.task) return Promise.resolve();
        var body = Object.assign({ id: state.task.id }, patch);
        return api('updateTask', body).then(function () {
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
