

const resourceName = (typeof GetParentResourceName === 'function') ? GetParentResourceName() : 'esx_jobsystem';

const JOB_IMAGE_RESOURCE = 'rlo_hud';
const JOB_IMAGE_PATH = 'html/img/jobs';
const JOB_IMAGE_EXT = 'png';

function getJobImageUrl(jobName) {
  if (!jobName) return null;
  return `nui://${JOB_IMAGE_RESOURCE}/${JOB_IMAGE_PATH}/${jobName}.${JOB_IMAGE_EXT}`;
}

async function nuiFetch(name, data = {}) {
  try {
    const resp = await fetch(`https://${resourceName}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(data),
    });
    return await resp.json();
  } catch (e) {
    return null;
  }
}

let I18N = {};

function t(key, ...args) {
  const text = I18N[key] !== undefined ? I18N[key] : key;
  return String(text).replace(/\{(\d+)\}/g, (_, n) => (args[Number(n) - 1] ?? ''));
}

function localeTag() {
  return I18N._locale || 'de-DE';
}

function applyStaticTranslations() {
  document.documentElement.lang = I18N._lang || 'de';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
}

async function loadLocale() {
  const data = await nuiFetch('getLocale');
  if (data) I18N = data;
  applyStaticTranslations();
}

loadLocale();

const state = {
  jobs: [],
  selectedJobName: null,
  jobDetail: null,
  activeTab: 'overview',
  search: '',
  filter: 'all',
  isNewJob: false,
  playersPollInterval: null,
  editingGradeId: null,
  editingGradeNumber: null,
  pendingDeleteGrade: null,
  charSearchDebounce: null,
  charResults: [],

  activeApp: null,

  activeEmpTab: 'overview',
  myJob: null,
  employees: null,
  hireSearchDebounce: null,

  jobCenter: null,
  activeJcTab: 'jobs',
  openApplicationJobs: [],
  myApplications: [],
  applyTargetJob: null,

  empApplications: [],

  adminApplications: [],

  activeThreadId: null,

  activeThreadSource: null,
};

const jobImageCache = new Map();

const jobGradesCache = new Map();

function buildSalarySteps() {
  const steps = [];
  for (let v = 0; v <= 1500; v += 50) steps.push(v);
  for (let v = 1600; v <= 5000; v += 100) steps.push(v);
  for (let v = 5200; v <= 10000; v += 200) steps.push(v);
  return steps;
}
const SALARY_STEPS = buildSalarySteps();

function salaryToStepIndex(value) {
  const v = Number(value) || 0;
  let closestIdx = 0;
  let closestDiff = Infinity;
  for (let i = 0; i < SALARY_STEPS.length; i++) {
    const diff = Math.abs(SALARY_STEPS[i] - v);
    if (diff < closestDiff) {
      closestDiff = diff;
      closestIdx = i;
    }
  }
  return closestIdx;
}

function stepIndexToSalary(idx) {
  const clamped = Math.max(0, Math.min(SALARY_STEPS.length - 1, idx));
  return SALARY_STEPS[clamped];
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const appEl = $('#app');
const jobListEl = $('#jobList');
const emptyStateEl = $('#emptyState');
const jobDetailEl = $('#jobDetail');
const gradesBodyEl = $('#gradesTableBody');
const gradesEmptyEl = $('#gradesEmpty');
const playersListEl = $('#playersList');
const playersEmptyEl = $('#playersEmpty');
const toastContainer = $('#toastContainer');
const jobChangeToastContainer = $('#jobChangeToastContainer');
const charResultsEl = $('#charResults');
const gmSalarySliderEl = $('#gmSalarySlider');
const gmSalaryDisplayEl = $('#gmSalaryDisplay');
gmSalarySliderEl.max = String(SALARY_STEPS.length - 1);

window.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.action === 'open') openApp();
  if (data.action === 'openEmployer') openEmployerApp();
  if (data.action === 'openJobCenter') openJobCenterApp();
  if (data.action === 'close') closeActiveApp();
  if (data.action === 'jobChangeNotify') showJobChangeToast(data.payload || {});
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.activeApp) {
    hideAllModals();
    nuiFetch('closeUI');
    closeActiveApp();
  }
});

function closeActiveApp() {
  if (state.activeApp === 'jobsettings') closeApp();
  else if (state.activeApp === 'employer') closeEmployerApp();
  else if (state.activeApp === 'jobcenter') closeJobCenterApp();
}

function openApp() {
  state.activeApp = 'jobsettings';
  appEl.classList.remove('hidden');
  resetDetailView();
  loadJobs();
}

function closeApp() {
  appEl.classList.add('hidden');
  state.activeApp = null;
  stopPlayersPolling();
  hideAllModals();
}

$('#closeBtn').addEventListener('click', () => {
  nuiFetch('closeUI');
  closeApp();
});

function analyzeJobImage(url) {
  return new Promise((resolve) => {
    if (!url) { resolve({ ok: false }); return; }

    const img = new Image();

    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || 64;
        canvas.height = img.naturalHeight || 64;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

        let total = 0;
        let count = 0;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha < 40) continue;
          const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
          total += lum;
          count += 1;
        }

        const brightness = count > 0 ? total / count : null;
        resolve({ ok: true, url, brightness });
      } catch (e) {

        resolve({ ok: true, url, brightness: null });
      }
    };

    img.onerror = () => resolve({ ok: false });
    img.src = url;
  });
}

function brightnessToBgClass(brightness) {
  if (brightness === null || brightness === undefined) return 'job-icon-bg-neutral';
  if (brightness < 90) return 'job-icon-bg-light';
  if (brightness > 165) return 'job-icon-bg-dark';
  return 'job-icon-bg-neutral';
}

function renderAvatarFromCache(el, cacheEntry, fallbackLabel) {
  if (!el) return;
  el.classList.remove('job-icon-bg-light', 'job-icon-bg-dark', 'job-icon-bg-neutral');

  if (cacheEntry && cacheEntry.ok) {
    el.classList.add(cacheEntry.bgCls);
    el.innerHTML = `<img src="${cacheEntry.url}" alt="">`;
  } else {
    el.innerHTML = '';
    el.textContent = (fallbackLabel || '?').charAt(0).toUpperCase() || '?';
  }
}

function applyJobAvatar(jobName, label, el) {
  if (!el || !jobName) return;
  el.dataset.jobAvatar = jobName;

  const cached = jobImageCache.get(jobName);
  if (cached) {
    renderAvatarFromCache(el, cached, label);
    return;
  }

  el.classList.remove('job-icon-bg-light', 'job-icon-bg-dark', 'job-icon-bg-neutral');
  el.innerHTML = '';
  el.textContent = (label || jobName || '?').charAt(0).toUpperCase() || '?';

  analyzeJobImage(getJobImageUrl(jobName)).then((result) => {
    const cacheEntry = result.ok
      ? { ok: true, url: result.url, bgCls: brightnessToBgClass(result.brightness) }
      : { ok: false };

    jobImageCache.set(jobName, cacheEntry);

    document.querySelectorAll(`[data-job-avatar="${cssEscape(jobName)}"]`).forEach((matchEl) => {
      renderAvatarFromCache(matchEl, cacheEntry, label);
    });
  });
}

function cssEscape(str) {
  if (window.CSS && CSS.escape) return CSS.escape(str);
  return String(str).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

async function loadJobs() {
  jobListEl.innerHTML = Array.from({ length: 6 }).map(() => '<div class="list-skeleton"></div>').join('');

  const jobs = await nuiFetch('getJobs');
  state.jobs = Array.isArray(jobs) ? jobs : [];
  renderJobList();
}

function applyFilters(jobs) {
  let list = jobs;

  if (state.search.trim() !== '') {
    const q = state.search.trim().toLowerCase();
    list = list.filter((j) => j.name.toLowerCase().includes(q) || (j.label || '').toLowerCase().includes(q));
  }

  if (state.filter === 'whitelisted') list = list.filter((j) => j.whitelisted);
  if (state.filter === 'public') list = list.filter((j) => !j.whitelisted);
  if (state.filter === 'society') list = list.filter((j) => j.hasSociety);

  return list;
}

function renderJobList() {
  const list = applyFilters(state.jobs);

  const totalOnline = state.jobs.reduce((sum, j) => sum + (j.onlineCount || 0), 0);
  const totalWl = state.jobs.filter((j) => j.whitelisted).length;
  $('#statTotalJobs').textContent = state.jobs.length;
  $('#statOnline').textContent = totalOnline;
  $('#statWhitelisted').textContent = totalWl;

  if (list.length === 0) {
    jobListEl.innerHTML = `
      <div class="table-empty" style="padding-top:40px;">
        <i class="fa-solid fa-magnifying-glass"></i>
        <span>${t('ui_no_apps_found')}</span>
      </div>`;
    return;
  }

  jobListEl.innerHTML = list.map((job, i) => `
    <div class="job-card ${job.name === state.selectedJobName ? 'active' : ''}" data-job="${job.name}" style="animation-delay:${i * 25}ms">
      <div class="job-card-avatar" data-job-avatar="${job.name}">${(job.label || job.name).charAt(0).toUpperCase()}</div>
      <div class="job-card-info">
        <div class="job-card-label">
          ${escapeHtml(job.label || job.name)}
          ${job.whitelisted ? '<i class="fa-solid fa-lock lock-icon" title="Whitelisted"></i>' : ''}
          ${job.applicationsOpen ? '<i class="fa-solid fa-file-signature applications-open-icon" title="' + t('app_phase_open') + '"></i>' : ''}
        </div>
        <div class="job-card-name">${escapeHtml(job.name)}</div>
      </div>
      <div class="job-card-meta">
        <span class="badge badge-online"><i class="fa-solid fa-circle"></i> ${job.onlineCount || 0}</span>
        <span class="badge">${job.gradeCount || 0} ${t('tab_grades')}</span>
      </div>
    </div>
  `).join('');

  $$('.job-card').forEach((el) => {
    el.addEventListener('click', () => selectJob(el.dataset.job));
  });

  list.forEach((job) => {
    const avatarEl = jobListEl.querySelector(`.job-card[data-job="${cssEscape(job.name)}"] .job-card-avatar`);
    applyJobAvatar(job.name, job.label, avatarEl);
  });
}

$('#searchInput').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderJobList();
});

$('#filterSelect').addEventListener('change', (e) => {
  state.filter = e.target.value;
  renderJobList();
});

async function selectJob(jobName) {
  state.selectedJobName = jobName;
  state.isNewJob = false;
  stopPlayersPolling();
  renderJobList();

  emptyStateEl.classList.add('hidden');
  jobDetailEl.classList.remove('hidden');
  setTabsEnabled(true);
  switchTab('overview');

  const job = await nuiFetch('getJobDetails', { jobName });
  if (!job) {
    showToast(t('ui_job_load_failed'), 'error');
    return;
  }

  state.jobDetail = job;
  jobGradesCache.set(jobName, job.grades || []);
  renderJobDetail(job);
}

function resetDetailView() {
  state.selectedJobName = null;
  state.jobDetail = null;
  state.isNewJob = false;
  emptyStateEl.classList.remove('hidden');
  jobDetailEl.classList.add('hidden');
  stopPlayersPolling();
}

function setTabsEnabled(enabled) {
  ['grades', 'society', 'players', 'applications'].forEach((t) => {
    const tabBtn = $(`.tab[data-tab="${t}"]`);
    tabBtn.classList.toggle('tab-disabled', !enabled);
  });
}

$('#newJobBtn').addEventListener('click', () => {
  state.selectedJobName = null;
  state.isNewJob = true;
  state.jobDetail = {
    name: '', label: '', whitelisted: false, grades: [], society: null,
  };
  renderJobList();

  emptyStateEl.classList.add('hidden');
  jobDetailEl.classList.remove('hidden');
  setTabsEnabled(false);
  switchTab('overview');
  renderJobDetail(state.jobDetail, true);
});

function renderJobDetail(job, isNew = false) {
  const avatarEl = $('#detailAvatar');
  if (isNew) {
    avatarEl.classList.remove('job-icon-bg-light', 'job-icon-bg-dark', 'job-icon-bg-neutral');
    delete avatarEl.dataset.jobAvatar;
    avatarEl.innerHTML = '';
    avatarEl.textContent = (job.label || job.name || '?').charAt(0).toUpperCase() || '?';
  } else {
    applyJobAvatar(job.name, job.label, avatarEl);
  }

  $('#detailLabel').textContent = isNew ? t('ui_new_job') : (job.label || job.name);
  $('#detailName').textContent = isNew ? t('ui_wait_save') : job.name;

  $('#ovLabel').value = job.label || '';
  $('#ovName').value = job.name || '';
  $('#ovName').disabled = !isNew;
  $('#ovWhitelisted').checked = !!job.whitelisted;
  $('#ovDescription').value = job.description || '';

  $('#deleteJobBtn').classList.toggle('hidden', isNew);
  $('#createOfflineJobBtn').classList.toggle('hidden', isNew || (job.name || '').startsWith('off'));

  if (!isNew) {
    renderGradesTab(job.grades || []);
    renderSocietyTab(job.society);

    $('#adOpen').checked = !!job.applicationsOpen;
    $('#adText').value = job.applicationText || '';
    state.adminApplications = [];
    renderAdminApplications();
  }
}

$$('.tab').forEach((tabBtn) => {
  tabBtn.addEventListener('click', () => {
    if (tabBtn.classList.contains('tab-disabled')) return;
    switchTab(tabBtn.dataset.tab);
  });
});

function switchTab(tabName) {
  state.activeTab = tabName;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tabName));
  $$('.tab-content').forEach((c) => c.classList.toggle('active', c.id === `tab-${tabName}`));

  if (tabName === 'players' && state.jobDetail && !state.isNewJob) {
    loadOnlinePlayers();
    startPlayersPolling();
  } else {
    stopPlayersPolling();
  }

  if (tabName === 'applications' && state.jobDetail && !state.isNewJob) {
    loadAdminApplications();
  }
}

$('#saveJobBtn').addEventListener('click', async () => {
  const payload = {
    name: $('#ovName').value.trim(),
    label: $('#ovLabel').value.trim(),
    whitelisted: $('#ovWhitelisted').checked,
    description: $('#ovDescription').value.trim(),
  };

  if (!payload.name || !payload.label) {
    showToast(t('ui_fill_name_label'), 'error');
    return;
  }

  setButtonLoading('#saveJobBtn', true);
  const res = await nuiFetch('saveJob', payload);
  setButtonLoading('#saveJobBtn', false);

  if (res && res.success) {
    showToast(state.isNewJob ? t('ui_job_created') : t('ui_job_updated'), 'success');
    const wasNew = state.isNewJob;
    state.isNewJob = false;
    await loadJobs();
    await selectJob(payload.name);
    if (wasNew) setTabsEnabled(true);
  } else {
    showToast((res && res.message) || t('ui_err_save'), 'error');
  }
});

$('#deleteJobBtn').addEventListener('click', () => {
  if (!state.selectedJobName) return;
  showConfirm(
    t('ui_confirm_delete_job_title'),
    t('ui_confirm_delete_job_text', state.jobDetail.label, state.selectedJobName),
    async () => {
      const res = await nuiFetch('deleteJob', { jobName: state.selectedJobName });
      if (res && res.success) {
        showToast(t('ui_job_deleted'), 'success');
        resetDetailView();
        loadJobs();
      } else {
        showToast((res && res.message) || t('ui_err_delete'), 'error');
      }
    }
  );
});

$('#createOfflineJobBtn').addEventListener('click', () => {
  if (!state.selectedJobName || state.isNewJob) return;
  const job = state.jobDetail;
  const offName = `off${state.selectedJobName}`;
  const offLabel = `Off-${job.label || state.selectedJobName}`;

  showConfirm(
    t('ui_confirm_offline_title'),
    t('ui_confirm_offline_text', offName, offLabel),
    async () => {
      setButtonLoading('#createOfflineJobBtn', true);
      const res = await nuiFetch('createOfflineJob', { jobName: state.selectedJobName });
      setButtonLoading('#createOfflineJobBtn', false);

      if (res && res.success) {
        showToast(t('ui_offjob_done', res.offJobName), 'success');
        await loadJobs();
      } else {
        showToast((res && res.message) || t('ui_err_offjob_create'), 'error');
      }
    }
  );
});

function renderGradesTab(grades) {
  if (!grades || grades.length === 0) {
    gradesBodyEl.innerHTML = '';
    gradesEmptyEl.classList.remove('hidden');
    return;
  }
  gradesEmptyEl.classList.add('hidden');

  gradesBodyEl.innerHTML = grades.map((g) => `
    <tr data-id="${g.id}">
      <td class="drag-handle-cell"><span class="drag-handle" title="${t('ui_drag_hint')}"><i class="fa-solid fa-grip-vertical"></i></span></td>
      <td><span class="grade-pill">${g.grade}</span></td>
      <td>${escapeHtml(g.name)}</td>
      <td>${escapeHtml(g.label)}</td>
      <td>$${Number(g.salary).toLocaleString(localeTag())}</td>
      <td>
        <div class="row-actions">
          <button class="edit-btn" data-id="${g.id}" title="${t('ui_edit_title')}"><i class="fa-solid fa-pen"></i></button>
          <button class="delete-btn" data-id="${g.id}" title="${t('ui_delete_title')}"><i class="fa-solid fa-trash"></i></button>
        </div>
      </td>
    </tr>
  `).join('');

  gradesBodyEl.querySelectorAll('.edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const grade = grades.find((g) => String(g.id) === btn.dataset.id);
      openGradeModal(grade);
    });
  });
  gradesBodyEl.querySelectorAll('.delete-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const grade = grades.find((g) => String(g.id) === btn.dataset.id);
      showConfirm(t('ui_confirm_delete_grade'), t('ui_confirm_delete_grade_text', grade.label, grade.grade), async () => {
        const res = await nuiFetch('deleteGrade', { id: grade.id });
        if (res && res.success) {
          showToast(t('ui_grade_deleted'), 'success');
          await refreshCurrentJobDetail();
        } else {
          showToast((res && res.message) || t('ui_err_delete'), 'error');
        }
      });
    });
  });

  initGradeDragAndDrop();
}

let gradeDrag = null;

function initGradeDragAndDrop() {
  gradesBodyEl.querySelectorAll('.drag-handle').forEach((handle) => {
    handle.addEventListener('mousedown', onGradeDragStart);
  });
}

function onGradeDragStart(e) {
  if (e.button !== 0) return;
  e.preventDefault();

  const row = e.target.closest('tr[data-id]');
  if (!row) return;

  const rows = Array.from(gradesBodyEl.querySelectorAll('tr[data-id]'));
  const draggedIndex = rows.indexOf(row);
  const rowHeight = row.getBoundingClientRect().height;

  gradeDrag = {
    rows,
    row,
    draggedIndex,
    currentIndex: draggedIndex,
    rowHeight,
    startY: e.clientY,
  };

  row.classList.add('grade-row-dragging');
  document.body.classList.add('grade-dragging-active');

  document.addEventListener('mousemove', onGradeDragMove);
  document.addEventListener('mouseup', onGradeDragEnd);
}

function onGradeDragMove(e) {
  if (!gradeDrag) return;
  const { rows, row, draggedIndex, rowHeight, startY } = gradeDrag;

  const deltaY = e.clientY - startY;
  row.style.transform = `translateY(${deltaY}px)`;

  const rawSteps = Math.round(deltaY / rowHeight);
  const newIndex = Math.max(0, Math.min(rows.length - 1, draggedIndex + rawSteps));

  if (newIndex !== gradeDrag.currentIndex) {
    rows.forEach((r, i) => {
      if (i === draggedIndex) return;
      let shift = 0;
      if (draggedIndex < newIndex && i > draggedIndex && i <= newIndex) {
        shift = -rowHeight;
      } else if (draggedIndex > newIndex && i >= newIndex && i < draggedIndex) {
        shift = rowHeight;
      }
      r.style.transform = shift ? `translateY(${shift}px)` : '';
    });
    gradeDrag.currentIndex = newIndex;
  }
}

async function onGradeDragEnd() {
  if (!gradeDrag) return;
  const { rows, row, draggedIndex, currentIndex } = gradeDrag;

  document.removeEventListener('mousemove', onGradeDragMove);
  document.removeEventListener('mouseup', onGradeDragEnd);
  document.body.classList.remove('grade-dragging-active');

  rows.forEach((r) => {
    r.style.transform = '';
    r.classList.remove('grade-row-dragging');
  });

  gradeDrag = null;

  if (currentIndex === draggedIndex) return;

  const newOrder = rows.slice();
  newOrder.splice(draggedIndex, 1);
  newOrder.splice(currentIndex, 0, row);
  newOrder.forEach((r) => gradesBodyEl.appendChild(r));

  await applyGradeOrder();
}

async function applyGradeOrder() {
  const order = Array.from(gradesBodyEl.querySelectorAll('tr[data-id]')).map((r) => r.dataset.id);
  if (order.length === 0 || !state.selectedJobName) return;

  const res = await nuiFetch('reorderGrades', { job_name: state.selectedJobName, order });
  if (res && res.success) {
    showToast(t('ui_grade_order_updated'), 'success');
    await refreshCurrentJobDetail();
  } else {
    showToast((res && res.message) || t('ui_err_reorder'), 'error');
    await refreshCurrentJobDetail();
  }
}

$('#addGradeBtn').addEventListener('click', () => {
  const grades = (state.jobDetail && state.jobDetail.grades) || [];
  const nextGrade = grades.length
    ? Math.max(...grades.map((g) => Number(g.grade))) + 1
    : 0;
  const lastSalary = grades.length
    ? grades.reduce((best, g) => (Number(g.grade) > Number(best.grade) ? g : best), grades[0]).salary
    : 0;

  openGradeModal(null, { grade: nextGrade, salary: lastSalary });
});

function setSalarySlider(value) {
  const idx = salaryToStepIndex(value);
  gmSalarySliderEl.value = String(idx);
  gmSalaryDisplayEl.textContent = `$${stepIndexToSalary(idx).toLocaleString(localeTag())}`;
}

function getSalarySliderValue() {
  return stepIndexToSalary(parseInt(gmSalarySliderEl.value, 10) || 0);
}

gmSalarySliderEl.addEventListener('input', () => {
  gmSalaryDisplayEl.textContent = `$${getSalarySliderValue().toLocaleString(localeTag())}`;
});

$('#gmSalaryPlus100').addEventListener('click', () => {
  setSalarySlider(Math.min(10000, getSalarySliderValue() + 100));
});
$('#gmSalaryPlus200').addEventListener('click', () => {
  setSalarySlider(Math.min(10000, getSalarySliderValue() + 200));
});

function openGradeModal(grade, prefill) {
  state.editingGradeId = grade ? grade.id : null;
  state.editingGradeNumber = grade ? grade.grade : (prefill ? prefill.grade : 0);

  $('#gradeModalTitle').innerHTML = grade
    ? '<i class="fa-solid fa-pen"></i> ' + t('ui_edit_grade')
    : '<i class="fa-solid fa-ranking-star"></i> ' + t('ui_add_grade');

  $('#gmName').value = grade ? grade.name : '';
  $('#gmLabel').value = grade ? grade.label : '';
  $('#gmSkinMale').value = grade ? grade.skin_male : '{}';
  $('#gmSkinFemale').value = grade ? grade.skin_female : '{}';

  setSalarySlider(grade ? grade.salary : (prefill ? prefill.salary : 0));

  $('#gradeModalOverlay').classList.remove('hidden');
}

function closeGradeModal() {
  $('#gradeModalOverlay').classList.add('hidden');
  state.editingGradeId = null;
  state.editingGradeNumber = null;
}
$('#gmCloseBtn').addEventListener('click', closeGradeModal);
$('#gmCancelBtn').addEventListener('click', closeGradeModal);

$('#gmSaveBtn').addEventListener('click', async () => {
  const payload = {
    id: state.editingGradeId,
    job_name: state.selectedJobName,
    grade: state.editingGradeNumber,
    salary: getSalarySliderValue(),
    name: $('#gmName').value.trim(),
    label: $('#gmLabel').value.trim(),
    skin_male: $('#gmSkinMale').value.trim() || '{}',
    skin_female: $('#gmSkinFemale').value.trim() || '{}',
  };

  if (Number.isNaN(payload.grade) || Number.isNaN(payload.salary) || !payload.name || !payload.label) {
    showToast(t('ui_fill_required_fields'), 'error');
    return;
  }

  try {
    JSON.parse(payload.skin_male);
    JSON.parse(payload.skin_female);
  } catch (e) {
    showToast(t('err_skin_json'), 'error');
    return;
  }

  setButtonLoading('#gmSaveBtn', true);
  const res = await nuiFetch('saveGrade', payload);
  setButtonLoading('#gmSaveBtn', false);

  if (res && res.success) {
    showToast(t('ui_grade_saved'), 'success');
    closeGradeModal();
    await refreshCurrentJobDetail();
  } else {
    showToast((res && res.message) || t('ui_err_save'), 'error');
  }
});

function renderSocietyTab(society) {
  if (!society) return;
  $('#socAccountName').textContent = society.name;
  $('#socLabel').value = society.label || '';
  $('#socShared').checked = !!society.shared;
  $('#socBalance').textContent = `$${Number(society.money || 0).toLocaleString(localeTag())}`;
  $('#socAmount').value = '';
}

async function submitSociety(moneyAction) {
  const amount = parseInt($('#socAmount').value, 10);
  if ((moneyAction !== 'none') && (Number.isNaN(amount) || amount < 0)) {
    showToast(t('ui_invalid_amount'), 'error');
    return;
  }

  const payload = {
    name: state.jobDetail.society.name,
    label: $('#socLabel').value.trim() || state.jobDetail.society.name,
    shared: $('#socShared').checked,
    moneyAction,
    amount: Number.isNaN(amount) ? 0 : amount,
  };

  const res = await nuiFetch('saveSociety', payload);
  if (res && res.success) {
    showToast(t('ui_society_updated'), 'success');
    await refreshCurrentJobDetail();
  } else {
    showToast((res && res.message) || t('ui_err_save'), 'error');
  }
}

$('#saveSocietyBtn').addEventListener('click', () => submitSociety('none'));
$('#socAddBtn').addEventListener('click', () => submitSociety('add'));
$('#socRemoveBtn').addEventListener('click', () => submitSociety('remove'));
$('#socSetBtn').addEventListener('click', () => submitSociety('set'));

async function loadOnlinePlayers() {
  if (!state.selectedJobName) return;
  const players = await nuiFetch('getOnlinePlayers', { jobName: state.selectedJobName });
  renderPlayersTab(Array.isArray(players) ? players : []);
}

function renderPlayersTab(players) {
  const gradeFilterEl = $('#playersGradeFilter');
  const currentFilterValue = gradeFilterEl.value || 'all';

  const grades = (state.jobDetail && state.jobDetail.grades) || [];
  gradeFilterEl.innerHTML = '<option value="all">' + t('ui_all_grades') + '</option>' +
    grades.map((g) => `<option value="${g.grade}">${escapeHtml(g.label)} (${g.grade})</option>`).join('');
  gradeFilterEl.value = currentFilterValue;

  let filtered = players;
  if (currentFilterValue !== 'all') {
    filtered = players.filter((p) => String(p.grade) === String(currentFilterValue));
  }

  $('#playersCount').textContent = players.length;

  if (filtered.length === 0) {
    playersListEl.innerHTML = '';
    playersEmptyEl.classList.remove('hidden');
    return;
  }
  playersEmptyEl.classList.add('hidden');

  playersListEl.innerHTML = filtered.map((p) => `
    <div class="player-row">
      <div class="player-avatar">${escapeHtml(p.name).charAt(0).toUpperCase()}</div>
      <div class="player-info">
        <div class="player-name">${escapeHtml(p.name)}</div>
        <div class="player-meta">
          <span class="id-badge">ID ${p.source}</span>
          <span>${escapeHtml(p.gradeLabel || '')}</span>
        </div>
      </div>
      <div class="player-actions">
        <select class="grade-select" data-source="${p.source}">
          ${grades.map((g) => `<option value="${g.grade}" ${g.grade === p.grade ? 'selected' : ''}>${escapeHtml(g.label)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-sm apply-grade-btn" data-source="${p.source}"><i class="fa-solid fa-check"></i></button>
        <button class="btn btn-danger btn-sm fire-btn" data-source="${p.source}" title="${t('ui_fire')}"><i class="fa-solid fa-user-slash"></i></button>
      </div>
    </div>
  `).join('');

  playersListEl.querySelectorAll('.apply-grade-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const source = btn.dataset.source;
      const select = playersListEl.querySelector(`.grade-select[data-source="${source}"]`);
      const res = await nuiFetch('setPlayerJob', { targetId: source, jobName: state.selectedJobName, grade: parseInt(select.value, 10) });
      if (res && res.success) {
        showToast(t('ui_grade_updated'), 'success');
        loadOnlinePlayers();
        loadJobs();
      } else {
        showToast((res && res.message) || t('ui_err_generic'), 'error');
      }
    });
  });

  playersListEl.querySelectorAll('.fire-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const source = btn.dataset.source;
      showConfirm(t('ui_fire_player_title'), t('ui_fire_player_text'), async () => {
        const res = await nuiFetch('setPlayerJob', { targetId: source, jobName: 'unemployed', grade: 0 });
        if (res && res.success) {
          showToast(t('ui_player_fired'), 'success');
          loadOnlinePlayers();
          loadJobs();
        } else {
          showToast((res && res.message) || t('ui_err_generic'), 'error');
        }
      });
    });
  });
}

$('#playersGradeFilter').addEventListener('change', () => loadOnlinePlayers());
$('#refreshPlayersBtn').addEventListener('click', () => loadOnlinePlayers());

function startPlayersPolling() {
  stopPlayersPolling();
  state.playersPollInterval = setInterval(() => {
    if (state.activeTab === 'players') loadOnlinePlayers();
  }, 5000);
}
function stopPlayersPolling() {
  if (state.playersPollInterval) {
    clearInterval(state.playersPollInterval);
    state.playersPollInterval = null;
  }
}

$('#characterManagementBtn').addEventListener('click', () => {
  $('#characterModalOverlay').classList.remove('hidden');
  $('#charSearchInput').value = '';
  $('#charSearchInput').focus();
  charResultsEl.innerHTML = `
    <div class="table-empty">
      <i class="fa-solid fa-users-viewfinder"></i>
      <span>${t('ui_char_hint')}</span>
    </div>`;
});

function closeCharacterModal() {
  $('#characterModalOverlay').classList.add('hidden');
}
$('#charCloseBtn').addEventListener('click', closeCharacterModal);
$('#charCloseBtn2').addEventListener('click', closeCharacterModal);

$('#charSearchInput').addEventListener('input', (e) => {
  const query = e.target.value.trim();
  clearTimeout(state.charSearchDebounce);

  if (query.length < 2) {
    charResultsEl.innerHTML = `
      <div class="table-empty">
        <i class="fa-solid fa-keyboard"></i>
        <span>${t('ui_min_chars')}</span>
      </div>`;
    return;
  }

  state.charSearchDebounce = setTimeout(() => runCharacterSearch(query), 300);
});

async function runCharacterSearch(query) {
  charResultsEl.innerHTML = `
    <div class="table-empty">
      <i class="fa-solid fa-spinner fa-spin"></i>
      <span>${t('ui_searching')}</span>
    </div>`;

  const results = await nuiFetch('searchCharacters', { query });
  state.charResults = Array.isArray(results) ? results : [];
  renderCharacterResults();
}

function renderCharacterResults() {
  const results = state.charResults;

  if (results.length === 0) {
    charResultsEl.innerHTML = `
      <div class="table-empty">
        <i class="fa-solid fa-user-slash"></i>
        <span>${t('ui_no_characters')}</span>
      </div>`;
    return;
  }

  const jobOptions = (state.jobs.length ? state.jobs : []).map((j) =>
    `<option value="${escapeHtml(j.name)}">${escapeHtml(j.label || j.name)}</option>`
  ).join('');

  charResultsEl.innerHTML = results.map((c) => `
    <div class="char-row" data-identifier="${escapeHtml(c.identifier)}">
      <div class="char-avatar" data-job-avatar="${escapeHtml(c.job || '')}">${(c.jobLabel || c.job || '?').charAt(0).toUpperCase()}</div>
      <div class="char-info">
        <div class="char-name">
          ${escapeHtml(c.name)}
          ${c.online ? '<span class="online-dot" title="' + t('ui_online') + '"></span>' : ''}
        </div>
        <div class="char-meta">
          <span class="id-badge">${escapeHtml(c.identifier)}</span>
          <span>${t('ui_current_prefix')} ${escapeHtml(c.jobLabel || c.job)} ${c.gradeLabel ? `(${escapeHtml(c.gradeLabel)})` : ''}</span>
        </div>
      </div>
      <div class="char-actions">
        <select class="char-job-select">${jobOptions}</select>
        <select class="char-grade-select"><option value="">${t('th_grade')}...</option></select>
        <button class="btn btn-primary btn-sm char-assign-btn"><i class="fa-solid fa-right-to-bracket"></i> ${t('ui_assign')}</button>
        <button class="btn btn-secondary btn-sm char-promote-btn" title="${t('ui_promote')}"><i class="fa-solid fa-arrow-up"></i></button>
        <button class="btn btn-secondary btn-sm char-demote-btn" title="${t('ui_demote')}"><i class="fa-solid fa-arrow-down"></i></button>
        <button class="btn btn-danger btn-sm char-fire-btn" title="${t('ui_fire')}"><i class="fa-solid fa-user-slash"></i></button>
      </div>
    </div>
  `).join('');

  results.forEach((c) => {
    const row = charResultsEl.querySelector(`.char-row[data-identifier="${cssEscape(c.identifier)}"]`);
    if (!row) return;
    const avatarEl = row.querySelector('.char-avatar');
    if (c.job) applyJobAvatar(c.job, c.jobLabel, avatarEl);

    const jobSelect = row.querySelector('.char-job-select');
    const gradeSelect = row.querySelector('.char-grade-select');
    if (c.job) jobSelect.value = c.job;

    const refreshGradeOptions = async () => {
      const jobName = jobSelect.value;
      gradeSelect.innerHTML = '<option value="">' + t('ui_loading') + '</option>';
      const grades = await getJobGrades(jobName);
      gradeSelect.innerHTML = grades.map((g) => `<option value="${g.grade}">${escapeHtml(g.label)} (${g.grade})</option>`).join('');
      if (jobName === c.job && c.grade !== undefined && c.grade !== null) {
        gradeSelect.value = c.grade;
      }
    };
    jobSelect.addEventListener('change', refreshGradeOptions);
    refreshGradeOptions();

    row.querySelector('.char-assign-btn').addEventListener('click', async () => {
      const jobName = jobSelect.value;
      const grade = parseInt(gradeSelect.value, 10);
      if (!jobName || Number.isNaN(grade)) {
        showToast(t('err_select_job_grade'), 'error');
        return;
      }
      await submitCharacterAction(c.identifier, 'assign', jobName, grade);
    });

    row.querySelector('.char-promote-btn').addEventListener('click', () => {
      submitCharacterAction(c.identifier, 'promote');
    });
    row.querySelector('.char-demote-btn').addEventListener('click', () => {
      submitCharacterAction(c.identifier, 'demote');
    });
    row.querySelector('.char-fire-btn').addEventListener('click', () => {
      showConfirm(t('ui_fire_char_title'), t('ui_confirm_fire_char_text', c.name), () => {
        submitCharacterAction(c.identifier, 'fire');
      });
    });
  });
}

async function getJobGrades(jobName) {
  if (jobGradesCache.has(jobName)) return jobGradesCache.get(jobName);
  const job = await nuiFetch('getJobDetails', { jobName });
  const grades = (job && job.grades) || [];
  jobGradesCache.set(jobName, grades);
  return grades;
}

async function submitCharacterAction(identifier, action, jobName, grade) {
  const res = await nuiFetch('setCharacterJob', { identifier, action, jobName, grade });
  if (res && res.success) {
    showToast(t('ui_char_updated'), 'success');
    const currentQuery = $('#charSearchInput').value.trim();
    if (currentQuery.length >= 2) runCharacterSearch(currentQuery);
    loadJobs();
  } else {
    showToast((res && res.message) || t('ui_err_update'), 'error');
  }
}

const employerAppEl = $('#employerApp');
const empEmployeesListEl = $('#empEmployeesList');
const empEmployeesEmptyEl = $('#empEmployeesEmpty');
const hireResultsEl = $('#hireResults');

function openEmployerApp() {
  state.activeApp = 'employer';
  employerAppEl.classList.remove('hidden');
  switchEmpTab('overview');
  loadMyJob();
}

function closeEmployerApp() {
  employerAppEl.classList.add('hidden');
  state.activeApp = null;
  hideAllModals();
}

$('#empCloseBtn').addEventListener('click', () => {
  nuiFetch('closeUI');
  closeEmployerApp();
});

$$('#empTabs .tab').forEach((tabBtn) => {
  tabBtn.addEventListener('click', () => {
    if (tabBtn.classList.contains('hidden')) return;
    switchEmpTab(tabBtn.dataset.empTab);
  });
});

function switchEmpTab(tab) {
  state.activeEmpTab = tab;
  $$('#empTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.empTab === tab));
  $$('#employerApp .tab-content').forEach((c) => c.classList.toggle('active', c.id === `emp-tab-${tab}`));
  if (tab === 'employees') loadEmployees();
  if (tab === 'applications') loadEmployerApplications();
}

async function loadMyJob() {
  const job = await nuiFetch('getMyJob');
  if (!job) {
    showToast(t('ui_myjob_load_failed'), 'error');
    return;
  }
  state.myJob = job;

  $('#empJobLabel').textContent = job.label || job.name;
  $('#empJobSub').textContent = job.name;
  $('#empJobName').textContent = job.label || job.name;
  $('#empGrade').textContent = `${job.myGradeLabel || ''}`;
  $('#empSalary').textContent = `$${Number(job.mySalary || 0).toLocaleString(localeTag())}`;

  const empWlEl = $('#empWhitelisted');
  empWlEl.innerHTML = job.whitelisted
    ? '<i class="fa-solid fa-lock"></i> ' + t('ui_status_restricted')
    : '<i class="fa-solid fa-lock-open"></i> ' + t('ui_status_public');
  empWlEl.classList.toggle('info-badge-warning', !!job.whitelisted);
  empWlEl.classList.toggle('info-badge-success', !job.whitelisted);

  const empAppPhaseEl = $('#empApplicationsPhase');
  empAppPhaseEl.innerHTML = job.applicationsOpen
    ? '<i class="fa-solid fa-door-open"></i> ' + t('ui_phase_open')
    : '<i class="fa-solid fa-door-closed"></i> ' + t('ui_phase_closed');
  empAppPhaseEl.classList.toggle('info-badge-success', !!job.applicationsOpen);
  empAppPhaseEl.classList.toggle('info-badge-warning', !job.applicationsOpen);

  $('#empDescription').textContent = job.description || t('ui_no_description');

  $('#empGradesBody').innerHTML = (job.grades || []).map((g) => `
    <tr class="${Number(g.grade) === Number(job.myGrade) ? 'grade-row-current' : ''}">
      <td><span class="grade-pill">${g.grade}</span></td>
      <td>${escapeHtml(g.label)}</td>
      <td>$${Number(g.salary).toLocaleString(localeTag())}</td>
    </tr>
  `).join('');

  $('#empEmployeesTabBtn').classList.toggle('hidden', !job.isManager);
  $('#empJobSettingsTabBtn').classList.toggle('hidden', !job.isManager);
  $('#empApplicationsTabBtn').classList.toggle('hidden', !job.isManager);
  if (!job.isManager && ['employees', 'jobsettings', 'applications'].includes(state.activeEmpTab)) {
    switchEmpTab('overview');
  }

  $('#jsLabel').value = job.label || '';
  $('#jsDescription').value = job.description || '';

  $('#asOpen').checked = !!job.applicationsOpen;
  $('#asText').value = job.applicationText || '';
}

async function loadEmployees() {
  empEmployeesListEl.innerHTML = Array.from({ length: 4 }).map(() => '<div class="list-skeleton"></div>').join('');
  const data = await nuiFetch('getEmployees');
  state.employees = data || { employees: [], grades: [], myGrade: 0 };
  renderEmployees();
}

function renderEmployees() {
  const { employees = [], grades = [], myGrade = 0 } = state.employees || {};
  $('#empEmployeeCount').textContent = employees.length;

  if (employees.length === 0) {
    empEmployeesListEl.innerHTML = '';
    empEmployeesEmptyEl.classList.remove('hidden');
    return;
  }
  empEmployeesEmptyEl.classList.add('hidden');

  empEmployeesListEl.innerHTML = employees.map((e) => `
    <div class="player-row ${e.canManage ? '' : 'player-row-locked'}">
      <div class="player-avatar">${escapeHtml(e.name).charAt(0).toUpperCase()}</div>
      <div class="player-info">
        <div class="player-name">
          ${escapeHtml(e.name)}
          ${e.online ? '<span class="online-dot" title="' + t('ui_online') + '"></span>' : ''}
        </div>
        <div class="player-meta">
          <span class="id-badge">${escapeHtml(e.identifier)}</span>
          <span>${escapeHtml(e.gradeLabel || '')}</span>
          ${!e.canManage ? '<span class="lock-note"><i class="fa-solid fa-lock"></i> ' + t('ui_not_manageable') + '</span>' : ''}
        </div>
      </div>
      <div class="player-actions">
        <select class="grade-select emp-grade-select" data-identifier="${escapeHtml(e.identifier)}" ${e.canManage ? '' : 'disabled'}>
          ${grades.map((g) => `<option value="${g.grade}" ${Number(g.grade) === Number(e.grade) ? 'selected' : ''} ${Number(g.grade) >= Number(myGrade) ? 'disabled' : ''}>${escapeHtml(g.label)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-sm emp-set-grade-btn" data-identifier="${escapeHtml(e.identifier)}" ${e.canManage ? '' : 'disabled'} title="${t('ui_set_grade')}"><i class="fa-solid fa-check"></i></button>
        <button class="btn btn-secondary btn-sm emp-promote-btn" data-identifier="${escapeHtml(e.identifier)}" ${e.canManage ? '' : 'disabled'} title="${t('ui_promote')}"><i class="fa-solid fa-arrow-up"></i></button>
        <button class="btn btn-secondary btn-sm emp-demote-btn" data-identifier="${escapeHtml(e.identifier)}" ${e.canManage ? '' : 'disabled'} title="${t('ui_demote')}"><i class="fa-solid fa-arrow-down"></i></button>
        <button class="btn btn-danger btn-sm emp-fire-btn" data-identifier="${escapeHtml(e.identifier)}" ${e.canManage ? '' : 'disabled'} title="${t('ui_fire')}"><i class="fa-solid fa-user-slash"></i></button>
      </div>
    </div>
  `).join('');

  empEmployeesListEl.querySelectorAll('.emp-set-grade-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.identifier;
      const select = empEmployeesListEl.querySelector(`.emp-grade-select[data-identifier="${cssEscape(id)}"]`);
      submitEmployeeAction(id, 'setGrade', parseInt(select.value, 10));
    });
  });
  empEmployeesListEl.querySelectorAll('.emp-promote-btn').forEach((btn) => {
    btn.addEventListener('click', () => submitEmployeeAction(btn.dataset.identifier, 'promote'));
  });
  empEmployeesListEl.querySelectorAll('.emp-demote-btn').forEach((btn) => {
    btn.addEventListener('click', () => submitEmployeeAction(btn.dataset.identifier, 'demote'));
  });
  empEmployeesListEl.querySelectorAll('.emp-fire-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      showConfirm(t('ui_employee_fired_title'), t('ui_employee_fired_text'), () => {
        submitEmployeeAction(btn.dataset.identifier, 'fire');
      });
    });
  });
}

async function submitEmployeeAction(identifier, action, grade) {
  const res = await nuiFetch('manageEmployee', { identifier, action, grade });
  if (res && res.success) {
    showToast(t('ui_employee_updated'), 'success');
    loadEmployees();
  } else {
    showToast((res && res.message) || t('ui_err_update'), 'error');
  }
}

$('#jsSaveBtn').addEventListener('click', async () => {
  const payload = {
    label: $('#jsLabel').value.trim(),
    description: $('#jsDescription').value.trim(),
  };

  if (!payload.label) {
    showToast(t('ui_label_required'), 'error');
    return;
  }

  setButtonLoading('#jsSaveBtn', true);
  const res = await nuiFetch('saveJobSettings', payload);
  setButtonLoading('#jsSaveBtn', false);

  if (res && res.success) {
    showToast(t('ui_job_settings_saved'), 'success');
    loadMyJob();
  } else {
    showToast((res && res.message) || t('ui_err_save'), 'error');
  }
});

$('#asSaveBtn').addEventListener('click', async () => {
  const payload = {
    applicationsOpen: $('#asOpen').checked,
    applicationText: $('#asText').value.trim(),
  };

  setButtonLoading('#asSaveBtn', true);
  const res = await nuiFetch('saveApplicationSettings', payload);
  setButtonLoading('#asSaveBtn', false);

  if (res && res.success) {
    showToast(t('ui_app_settings_saved'), 'success');
    loadMyJob();
  } else {
    showToast((res && res.message) || t('ui_err_save'), 'error');
  }
});

const empApplicationsListEl = $('#empApplicationsList');
const empApplicationsEmptyEl = $('#empApplicationsEmpty');

async function loadEmployerApplications() {
  empApplicationsListEl.innerHTML = Array.from({ length: 3 }).map(() => '<div class="list-skeleton"></div>').join('');
  const apps = await nuiFetch('getJobApplications');
  state.empApplications = Array.isArray(apps) ? apps : [];
  renderEmployerApplications();
}

function renderEmployerApplications() {
  const apps = state.empApplications;
  $('#empApplicationsCount').textContent = apps.length;
  const openCount = apps.filter((a) => a.status === 'open').length;
  $('#empApplicationsOpenCount').textContent = openCount;

  if (apps.length === 0) {
    empApplicationsListEl.innerHTML = '';
    empApplicationsEmptyEl.classList.remove('hidden');
    return;
  }
  empApplicationsEmptyEl.classList.add('hidden');

  empApplicationsListEl.innerHTML = apps.map((a) => `
    <div class="application-row" data-id="${a.id}">
      <div class="application-row-info">
        <div class="application-row-title">${escapeHtml(a.subject)}</div>
        <div class="application-row-meta">
          <span>${escapeHtml(a.applicant_name)}</span>
          <span>${formatAppDate(a.updated_at)}</span>
        </div>
      </div>
      ${applicationStatusBadge(a.status)}
    </div>
  `).join('');

  empApplicationsListEl.querySelectorAll('.application-row').forEach((row) => {
    row.addEventListener('click', () => openApplicationThread(parseInt(row.dataset.id, 10), 'employer'));
  });
}

$('#empApplicationsRefreshBtn').addEventListener('click', () => loadEmployerApplications());

$('#adSaveBtn').addEventListener('click', async () => {
  if (!state.selectedJobName || state.isNewJob) return;

  const payload = {
    jobName: state.selectedJobName,
    applicationsOpen: $('#adOpen').checked,
    applicationText: $('#adText').value.trim(),
  };

  setButtonLoading('#adSaveBtn', true);
  const res = await nuiFetch('saveAdminApplicationSettings', payload);
  setButtonLoading('#adSaveBtn', false);

  if (res && res.success) {
    showToast(t('ui_app_settings_saved'), 'success');

    await loadJobs();
    await selectJob(state.selectedJobName);
    switchTab('applications');
  } else {
    showToast((res && res.message) || t('ui_err_save'), 'error');
  }
});

const adApplicationsListEl = $('#adApplicationsList');
const adApplicationsEmptyEl = $('#adApplicationsEmpty');

async function loadAdminApplications() {
  if (!state.selectedJobName || state.isNewJob) return;
  adApplicationsListEl.innerHTML = Array.from({ length: 3 }).map(() => '<div class="list-skeleton"></div>').join('');
  const apps = await nuiFetch('getAdminJobApplications', { jobName: state.selectedJobName });
  state.adminApplications = Array.isArray(apps) ? apps : [];
  renderAdminApplications();
}

function renderAdminApplications() {
  const apps = state.adminApplications;
  $('#adApplicationsCount').textContent = apps.length;
  const openCount = apps.filter((a) => a.status === 'open').length;
  $('#adApplicationsOpenCount').textContent = openCount;

  if (apps.length === 0) {
    adApplicationsListEl.innerHTML = '';
    adApplicationsEmptyEl.classList.remove('hidden');
    return;
  }
  adApplicationsEmptyEl.classList.add('hidden');

  adApplicationsListEl.innerHTML = apps.map((a) => `
    <div class="application-row" data-id="${a.id}">
      <div class="application-row-info">
        <div class="application-row-title">${escapeHtml(a.subject)}</div>
        <div class="application-row-meta">
          <span>${escapeHtml(a.applicant_name)}</span>
          <span>${formatAppDate(a.updated_at)}</span>
        </div>
      </div>
      ${applicationStatusBadge(a.status)}
    </div>
  `).join('');

  adApplicationsListEl.querySelectorAll('.application-row').forEach((row) => {
    row.addEventListener('click', () => openApplicationThread(parseInt(row.dataset.id, 10), 'admin'));
  });
}

$('#adApplicationsRefreshBtn').addEventListener('click', () => loadAdminApplications());

$('#empHireBtn').addEventListener('click', () => {
  $('#hireModalOverlay').classList.remove('hidden');
  $('#hireSearchInput').value = '';
  $('#hireSearchInput').focus();
  hireResultsEl.innerHTML = `
    <div class="table-empty">
      <i class="fa-solid fa-users-viewfinder"></i>
      <span>${t('ui_hire_hint_players')}</span>
    </div>`;
});

function closeHireModal() {
  $('#hireModalOverlay').classList.add('hidden');
}
$('#hireCloseBtn').addEventListener('click', closeHireModal);
$('#hireCloseBtn2').addEventListener('click', closeHireModal);

$('#hireSearchInput').addEventListener('input', (e) => {
  const query = e.target.value.trim();
  clearTimeout(state.hireSearchDebounce);

  if (query.length < 2) {
    hireResultsEl.innerHTML = `
      <div class="table-empty">
        <i class="fa-solid fa-keyboard"></i>
        <span>${t('ui_min_chars')}</span>
      </div>`;
    return;
  }

  state.hireSearchDebounce = setTimeout(() => runHireSearch(query), 300);
});

async function runHireSearch(query) {
  hireResultsEl.innerHTML = `
    <div class="table-empty">
      <i class="fa-solid fa-spinner fa-spin"></i>
      <span>${t('ui_searching')}</span>
    </div>`;

  const results = await nuiFetch('searchHireCandidates', { query });
  renderHireResults(Array.isArray(results) ? results : []);
}

function renderHireResults(results) {
  if (results.length === 0) {
    hireResultsEl.innerHTML = `
      <div class="table-empty">
        <i class="fa-solid fa-user-slash"></i>
        <span>${t('ui_no_players_found')}</span>
      </div>`;
    return;
  }

  const myGrade = state.myJob ? Number(state.myJob.myGrade) : 0;
  const grades = (state.myJob && state.myJob.grades) || [];
  const gradeOptions = grades
    .filter((g) => Number(g.grade) < myGrade)
    .map((g) => `<option value="${g.grade}">${escapeHtml(g.label)} (${g.grade})</option>`)
    .join('');

  hireResultsEl.innerHTML = results.map((c) => `
    <div class="char-row" data-identifier="${escapeHtml(c.identifier)}">
      <div class="char-avatar">${escapeHtml(c.name || '?').charAt(0).toUpperCase()}</div>
      <div class="char-info">
        <div class="char-name">
          ${escapeHtml(c.name)}
          ${c.online ? '<span class="online-dot" title="' + t('ui_online') + '"></span>' : ''}
        </div>
        <div class="char-meta">
          <span class="id-badge">${escapeHtml(c.identifier)}</span>
          <span>${t('ui_current_prefix')} ${escapeHtml(c.jobLabel || c.job)}</span>
        </div>
      </div>
      <div class="char-actions">
        <select class="hire-grade-select">${gradeOptions || '<option value="0">' + t('ui_no_grade_available') + '</option>'}</select>
        <button class="btn btn-primary btn-sm hire-confirm-btn" ${gradeOptions ? '' : 'disabled'}><i class="fa-solid fa-user-plus"></i> ${t('ui_hire')}</button>
      </div>
    </div>
  `).join('');

  results.forEach((c) => {
    const row = hireResultsEl.querySelector(`.char-row[data-identifier="${cssEscape(c.identifier)}"]`);
    if (!row) return;
    row.querySelector('.hire-confirm-btn').addEventListener('click', async () => {
      const gradeSelect = row.querySelector('.hire-grade-select');
      const grade = parseInt(gradeSelect.value, 10);
      const res = await nuiFetch('hireEmployee', { identifier: c.identifier, grade });
      if (res && res.success) {
        showToast(t('ui_employee_hired'), 'success');
        closeHireModal();
        loadEmployees();
      } else {
        showToast((res && res.message) || t('ui_err_hire'), 'error');
      }
    });
  });
}

const jobCenterAppEl = $('#jobCenterApp');
const jcJobsListEl = $('#jcJobsList');
const jcJobsEmptyEl = $('#jcJobsEmpty');

function openJobCenterApp() {
  state.activeApp = 'jobcenter';
  jobCenterAppEl.classList.remove('hidden');
  $('#jcSearchInput').value = '';
  switchJcTab('jobs');
  loadJobCenter();
  loadOpenApplicationJobs();
  loadMyApplications();
}

function closeJobCenterApp() {
  jobCenterAppEl.classList.add('hidden');
  state.activeApp = null;
  hideAllModals();
}

$$('#jcTabs .tab').forEach((tabBtn) => {
  tabBtn.addEventListener('click', () => switchJcTab(tabBtn.dataset.jcTab));
});

function switchJcTab(tab) {
  state.activeJcTab = tab;
  $$('#jcTabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.jcTab === tab));
  $$('#jobCenterApp .tab-content').forEach((c) => c.classList.toggle('active', c.id === `jc-tab-${tab}`));
  $('#jcSearchBox').classList.toggle('hidden', tab !== 'jobs');
  if (tab === 'applications') loadOpenApplicationJobs();
  if (tab === 'myapplications') loadMyApplications();
}

$('#jcCloseBtn').addEventListener('click', () => {
  nuiFetch('closeUI');
  closeJobCenterApp();
});

$('#jcSearchInput').addEventListener('input', () => renderJobCenter());

async function loadJobCenter() {
  jcJobsListEl.innerHTML = Array.from({ length: 4 }).map(() => '<div class="list-skeleton"></div>').join('');
  const data = await nuiFetch('getJobCenterJobs');
  state.jobCenter = data || { jobs: [] };
  renderJobCenter();
}

function renderJobCenter() {
  const data = state.jobCenter || {};

  $('#jcMyJob').textContent = data.myJobLabel || data.myJob || '-';
  $('#jcMyGrade').textContent = `${data.myGradeLabel || ''}`;
  $('#jcWhitelistNotice').style.display = data.myHireable ? 'none' : 'flex';

  const search = ($('#jcSearchInput').value || '').trim().toLowerCase();
  let jobs = data.jobs || [];
  if (search) {
    jobs = jobs.filter((j) => j.name.toLowerCase().includes(search) || (j.label || '').toLowerCase().includes(search));
  }

  if (jobs.length === 0) {
    jcJobsListEl.innerHTML = '';
    jcJobsEmptyEl.classList.remove('hidden');
    return;
  }
  jcJobsEmptyEl.classList.add('hidden');

  jcJobsListEl.innerHTML = jobs.map((j) => {
    const isCurrent = j.name === data.myJob;
    const canApply = data.myHireable && !isCurrent;
    const firstGrade = (j.grades && j.grades[0]) || null;
    let disabledReason = '';
    if (isCurrent) disabledReason = t('ui_already_your_job');
    else if (!data.myHireable) disabledReason = t('ui_must_be_fired');

    return `
    <div class="jc-job-card">
      <div class="jc-job-header">
        <div class="job-card-avatar" data-job-avatar="${j.name}">${(j.label || j.name).charAt(0).toUpperCase()}</div>
        <div class="jc-job-header-info">
          <div class="jc-job-title">${escapeHtml(j.label || j.name)} ${isCurrent ? '<span class="badge badge-online">' + t('ui_current_job') + '</span>' : ''}</div>
          <div class="jc-job-salary">${t('ui_entry_salary')} $${Number(firstGrade ? firstGrade.salary : 0).toLocaleString(localeTag())}</div>
        </div>
        <button class="btn btn-primary btn-sm jc-apply-btn" data-job="${j.name}" ${canApply ? '' : 'disabled'} title="${disabledReason}">
          <i class="fa-solid fa-right-to-bracket"></i><span>${t('ui_accept_job')}</span>
        </button>
      </div>
      <p class="jc-job-desc">${escapeHtml(j.description || t('ui_no_description'))}</p>
      <div class="jc-job-grades">
        ${(j.grades || []).map((g) => `<span class="jc-grade-chip">${escapeHtml(g.label)} · $${Number(g.salary).toLocaleString(localeTag())}</span>`).join('')}
      </div>
    </div>`;
  }).join('');

  jobs.forEach((j) => {
    const avatarEl = jcJobsListEl.querySelector(`.jc-job-card [data-job-avatar="${cssEscape(j.name)}"]`);
    if (avatarEl) applyJobAvatar(j.name, j.label, avatarEl);
  });

  jcJobsListEl.querySelectorAll('.jc-apply-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const jobName = btn.dataset.job;
      const job = jobs.find((x) => x.name === jobName);
      showConfirm(t('ui_accept_job'), t('ui_accept_job_text', job ? (job.label || jobName) : jobName), async () => {
        const res = await nuiFetch('applyJobCenterJob', { jobName });
        if (res && res.success) {
          showToast(t('ui_job_accepted'), 'success');
          loadJobCenter();
        } else {
          showToast((res && res.message) || t('ui_err_job_change'), 'error');
        }
      });
    });
  });
}

const jcApplyJobsListEl = $('#jcApplyJobsList');
const jcApplyJobsEmptyEl = $('#jcApplyJobsEmpty');

async function loadOpenApplicationJobs() {
  jcApplyJobsListEl.innerHTML = Array.from({ length: 3 }).map(() => '<div class="list-skeleton"></div>').join('');
  const jobs = await nuiFetch('getOpenApplicationJobs');
  state.openApplicationJobs = Array.isArray(jobs) ? jobs : [];
  renderOpenApplicationJobs();
}

function renderOpenApplicationJobs() {
  const jobs = state.openApplicationJobs;

  if (jobs.length === 0) {
    jcApplyJobsListEl.innerHTML = '';
    jcApplyJobsEmptyEl.classList.remove('hidden');
    return;
  }
  jcApplyJobsEmptyEl.classList.add('hidden');

  jcApplyJobsListEl.innerHTML = jobs.map((j) => `
    <div class="jc-job-card">
      <div class="jc-job-header">
        <div class="job-card-avatar" data-job-avatar="${j.name}">${(j.label || j.name).charAt(0).toUpperCase()}</div>
        <div class="jc-job-header-info">
          <div class="jc-job-title">${escapeHtml(j.label || j.name)}</div>
          <div class="jc-job-salary">${t('ui_entry_salary')} $${Number((j.grades && j.grades[0]) ? j.grades[0].salary : 0).toLocaleString(localeTag())}</div>
        </div>
        <button class="btn btn-primary btn-sm jc-apply-write-btn" data-job="${j.name}">
          <i class="fa-solid fa-file-signature"></i><span>${t('ui_apply')}</span>
        </button>
      </div>
      <p class="jc-job-desc">${escapeHtml(j.description || t('ui_no_description'))}</p>
      ${j.application_text ? `<div class="jc-job-application-text"><i class="fa-solid fa-bullhorn"></i> ${escapeHtml(j.application_text)}</div>` : ''}
      <div class="jc-job-grades">
        ${(j.grades || []).map((g) => `<span class="jc-grade-chip">${escapeHtml(g.label)} · $${Number(g.salary).toLocaleString(localeTag())}</span>`).join('')}
      </div>
    </div>`).join('');

  jobs.forEach((j) => {
    const avatarEl = jcApplyJobsListEl.querySelector(`.jc-job-card [data-job-avatar="${cssEscape(j.name)}"]`);
    if (avatarEl) applyJobAvatar(j.name, j.label, avatarEl);
  });

  jcApplyJobsListEl.querySelectorAll('.jc-apply-write-btn').forEach((btn) => {
    btn.addEventListener('click', () => openApplyModal(btn.dataset.job));
  });
}

async function openApplyModal(jobName) {
  const job = state.openApplicationJobs.find((j) => j.name === jobName);
  state.applyTargetJob = jobName;

  $('#applyTargetJob').innerHTML = `<i class="fa-solid fa-briefcase"></i> ${t('ui_application_for')} <strong>${escapeHtml(job ? (job.label || jobName) : jobName)}</strong>`;
  $('#applySubject').value = '';
  $('#applyBody').value = '';
  $('#applyGreeting').value = t('ui_wait_loading');

  $('#applyModalOverlay').classList.remove('hidden');

  const myName = await nuiFetch('getMyName');
  $('#applyGreeting').value = `${t('ui_greeting')}, ${myName || ''}`;
}

function closeApplyModal() {
  $('#applyModalOverlay').classList.add('hidden');
  state.applyTargetJob = null;
}
$('#applyCloseBtn').addEventListener('click', closeApplyModal);
$('#applyCancelBtn').addEventListener('click', closeApplyModal);

$('#applySubmitBtn').addEventListener('click', async () => {
  const payload = {
    jobName: state.applyTargetJob,
    subject: $('#applySubject').value.trim(),
    body: $('#applyBody').value.trim(),
  };

  if (!payload.jobName || !payload.subject || !payload.body) {
    showToast(t('err_subject_body_required'), 'error');
    return;
  }

  setButtonLoading('#applySubmitBtn', true);
  const res = await nuiFetch('submitApplication', payload);
  setButtonLoading('#applySubmitBtn', false);

  if (res && res.success) {
    showToast(t('ui_app_sent'), 'success');
    closeApplyModal();
    loadMyApplications();
  } else {
    showToast((res && res.message) || t('ui_err_send_app'), 'error');
  }
});

const jcMyApplicationsListEl = $('#jcMyApplicationsList');
const jcMyApplicationsEmptyEl = $('#jcMyApplicationsEmpty');

async function loadMyApplications() {
  jcMyApplicationsListEl.innerHTML = Array.from({ length: 3 }).map(() => '<div class="list-skeleton"></div>').join('');
  const apps = await nuiFetch('getMyApplications');
  state.myApplications = Array.isArray(apps) ? apps : [];
  renderMyApplications();
}

function renderMyApplications() {
  const apps = state.myApplications;
  $('#jcMyApplicationsCount').textContent = apps.length;

  if (apps.length === 0) {
    jcMyApplicationsListEl.innerHTML = '';
    jcMyApplicationsEmptyEl.classList.remove('hidden');
    return;
  }
  jcMyApplicationsEmptyEl.classList.add('hidden');

  jcMyApplicationsListEl.innerHTML = apps.map((a) => `
    <div class="application-row" data-id="${a.id}">
      <div class="application-row-info">
        <div class="application-row-title">${escapeHtml(a.jobLabel || a.job_name)} · ${escapeHtml(a.subject)}</div>
        <div class="application-row-meta">
          <span>${formatAppDate(a.updated_at)}</span>
        </div>
      </div>
      ${applicationStatusBadge(a.status)}
    </div>
  `).join('');

  jcMyApplicationsListEl.querySelectorAll('.application-row').forEach((row) => {
    row.addEventListener('click', () => openApplicationThread(parseInt(row.dataset.id, 10), 'jobcenter'));
  });
}

const APPLICATION_STATUS_LABELS = {
  open: t('ui_status_open'),
  accepted: t('ui_status_accepted'),
  declined: t('ui_status_declined'),
  declined_final: t('ui_status_declined_final'),
};

function applicationStatusBadge(status) {
  return `<span class="app-status-badge app-status-${status}">${APPLICATION_STATUS_LABELS[status] || status}</span>`;
}

function formatAppDate(dateStr) {
  if (dateStr === null || dateStr === undefined || dateStr === '') return '';

  let d;
  if (typeof dateStr === 'number') {

    d = new Date(dateStr > 100000000000 ? dateStr : dateStr * 1000);
  } else if (/^\d+$/.test(String(dateStr).trim())) {

    const num = Number(dateStr);
    d = new Date(num > 100000000000 ? num : num * 1000);
  } else {
    d = new Date(String(dateStr).replace(' ', 'T'));
  }

  if (Number.isNaN(d.getTime())) return escapeHtml(String(dateStr));
  return d.toLocaleString(localeTag(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function openApplicationThread(id, source = null) {
  state.activeThreadId = id;
  state.activeThreadSource = source;
  $('#appThreadModalOverlay').classList.remove('hidden');
  $('#appThreadChat').innerHTML = '<div class="list-skeleton"></div>';
  $('#appThreadOriginal').innerHTML = '';
  await refreshApplicationThread();
}

function refreshApplicationListForActiveThread() {
  if (state.activeThreadSource === 'employer') loadEmployerApplications();
  else if (state.activeThreadSource === 'admin') loadAdminApplications();
  else if (state.activeThreadSource === 'jobcenter') loadMyApplications();
}

async function refreshApplicationThread() {
  if (!state.activeThreadId) return;
  const app = await nuiFetch('getApplicationThread', { id: state.activeThreadId });

  if (!app) {
    showToast(t('ui_app_load_failed'), 'error');
    closeApplicationThreadModal();
    return;
  }

  $('#appThreadTitle').innerHTML = `<i class="fa-solid fa-comments"></i> ${t('ui_application_from')} ${escapeHtml(app.applicant_name)}`;
  $('#appThreadSubject').textContent = app.subject;
  $('#appThreadStatusBadge').outerHTML = `<span class="app-status-badge app-status-${app.status}" id="appThreadStatusBadge">${APPLICATION_STATUS_LABELS[app.status] || app.status}</span>`;

  $('#appThreadOriginal').innerHTML = `
    <div class="app-thread-original-header">
      <i class="fa-solid fa-envelope-open-text"></i> ${t('ui_original_application')} · ${formatAppDate(app.created_at)}
    </div>
    <div class="app-thread-original-body">${escapeHtml(app.body)}</div>
    <div class="app-thread-original-greeting">${escapeHtml(app.greeting)}</div>
  `;

  const managerActionsEl = $('#appThreadManagerActions');
  managerActionsEl.classList.toggle('hidden', !app.isManagerView);
  managerActionsEl.querySelectorAll('button[data-status]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.status === app.status);
  });

  const messages = app.messages || [];
  $('#appThreadChat').innerHTML = messages.length === 0
    ? '<div class="app-thread-chat-empty">' + t('ui_chat_empty') + '</div>'
    : messages.map((m) => `
      <div class="chat-bubble chat-bubble-${m.sender === 'manager' ? 'manager' : 'applicant'}">
        <div class="chat-bubble-meta">${escapeHtml(m.sender_name)} · ${formatAppDate(m.created_at)}</div>
        <div class="chat-bubble-text">${escapeHtml(m.message)}</div>
      </div>
    `).join('');

  $('#appThreadReplyBox').classList.toggle('hidden', !app.canReply);
  $('#appThreadClosedNote').classList.toggle('hidden', app.canReply);
  $('#appThreadReplyText').value = '';

  const chatEl = $('#appThreadChat');
  chatEl.scrollTop = chatEl.scrollHeight;
}

$('#appThreadManagerActions').querySelectorAll('button[data-status]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    if (!state.activeThreadId) return;
    const res = await nuiFetch('updateApplicationStatus', { id: state.activeThreadId, status: btn.dataset.status });
    if (res && res.success) {
      showToast(t('ui_app_status_updated'), 'success');
      await refreshApplicationThread();
      refreshApplicationListForActiveThread();
    } else {
      showToast((res && res.message) || t('ui_err_update'), 'error');
    }
  });
});

$('#appThreadReplyBtn').addEventListener('click', async () => {
  const message = $('#appThreadReplyText').value.trim();
  if (!message || !state.activeThreadId) return;

  setButtonLoading('#appThreadReplyBtn', true);
  const res = await nuiFetch('sendApplicationMessage', { id: state.activeThreadId, message });
  setButtonLoading('#appThreadReplyBtn', false);

  if (res && res.success) {
    await refreshApplicationThread();
    refreshApplicationListForActiveThread();
  } else {
    showToast((res && res.message) || t('ui_err_send'), 'error');
  }
});

function closeApplicationThreadModal() {
  $('#appThreadModalOverlay').classList.add('hidden');
  state.activeThreadId = null;
  state.activeThreadSource = null;
}
$('#appThreadCloseBtn').addEventListener('click', closeApplicationThreadModal);
$('#appThreadCloseBtn2').addEventListener('click', closeApplicationThreadModal);

function showJobChangeToast(payload) {
  const {
    oldJobLabel = '', oldGradeLabel = '',
    newJobLabel = '', newGradeLabel = '',
  } = payload;

  const toast = document.createElement('div');
  toast.className = 'job-change-toast';
  toast.innerHTML = `
    <div class="jc-title">${t('ui_job_changed')}</div>
    <div class="jc-row jc-old">
      <span class="jc-job">${escapeHtml(oldJobLabel)}</span>
      ${oldGradeLabel ? `<span class="jc-grade">${escapeHtml(oldGradeLabel)}</span>` : ''}
    </div>
    <div class="jc-arrow"><i class="fa-solid fa-arrow-down"></i></div>
    <div class="jc-row jc-new">
      <span class="jc-job">${escapeHtml(newJobLabel)}</span>
      ${newGradeLabel ? `<span class="jc-grade">${escapeHtml(newGradeLabel)}</span>` : ''}
    </div>
  `;
  jobChangeToastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 240);
  }, 20000);
}

async function refreshCurrentJobDetail() {
  if (!state.selectedJobName) return;
  const job = await nuiFetch('getJobDetails', { jobName: state.selectedJobName });
  if (job) {
    state.jobDetail = job;
    jobGradesCache.set(state.selectedJobName, job.grades || []);
    renderJobDetail(job);
  }
  loadJobs();
}

function showConfirm(title, text, onConfirm) {
  $('#confirmTitle').innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${title}`;
  $('#confirmText').textContent = text;
  $('#confirmModalOverlay').classList.remove('hidden');

  const okBtn = $('#confirmOkBtn');
  const cancelBtn = $('#confirmCancelBtn');

  const newOkBtn = okBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOkBtn, okBtn);
  const newCancelBtn = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

  newOkBtn.addEventListener('click', () => {
    $('#confirmModalOverlay').classList.add('hidden');
    onConfirm();
  });
  newCancelBtn.addEventListener('click', () => {
    $('#confirmModalOverlay').classList.add('hidden');
  });
}

function hideAllModals() {
  $('#gradeModalOverlay').classList.add('hidden');
  $('#characterModalOverlay').classList.add('hidden');
  $('#confirmModalOverlay').classList.add('hidden');
  $('#hireModalOverlay').classList.add('hidden');
  $('#applyModalOverlay').classList.add('hidden');
  $('#appThreadModalOverlay').classList.add('hidden');
}

function showToast(message, type = 'info') {
  const icons = { success: 'fa-circle-check', error: 'fa-circle-exclamation', info: 'fa-circle-info' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-out');
    setTimeout(() => toast.remove(), 220);
  }, 3800);
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function setButtonLoading(selector, loading) {
  const btn = $(selector);
  if (!btn) return;
  btn.disabled = loading;
  btn.style.opacity = loading ? '0.6' : '1';
  btn.style.pointerEvents = loading ? 'none' : 'auto';
}