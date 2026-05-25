/**
 * app.js - ZenMatrix Core Application Logic
 * Implements Eisenhower Matrix Task Management, Hashtag Parsing,
 * HTML5 Drag & Drop, Local Storage, and Google Tasks API Integration.
 */

// ==========================================
// 1. CONFIGURATION & STATE MANAGEMENT
// ==========================================

const QUADRANT_TAGS = {
  Q1: '#do',
  Q2: '#schedule',
  Q3: '#delegate',
  Q4: '#eliminate'
};

const TAG_REGEX = /(?:#(q1|q2|q3|q4|do|schedule|delegate|eliminate))\b/gi;

// Application State
const state = {
  tasks: [],
  // Local Wi-Fi Sync State
  syncServerIp: localStorage.getItem('zenmatrix_sync_server') || 'http://localhost:3000',
  syncKey: localStorage.getItem('zenmatrix_sync_key') || '',
  lastSyncTimestamp: parseInt(localStorage.getItem('zenmatrix_last_sync') || '0', 10),
  
  // Google Tasks Cloud Sync State
  googleClientId: localStorage.getItem('zenmatrix_client_id') || '',
  googleTaskListId: localStorage.getItem('zenmatrix_tasklist_id') || '',
  googleAccessToken: localStorage.getItem('zenmatrix_access_token') || '',
  googleTokenExpiry: parseInt(localStorage.getItem('zenmatrix_token_expiry') || '0', 10),
  activeTaskListTitle: localStorage.getItem('zenmatrix_tasklist_title') || '',
  
  // General Sync Config
  isSyncing: false,
  activeSyncMode: localStorage.getItem('zenmatrix_sync_mode') || 'OFFLINE', // 'OFFLINE' | 'WIFI' | 'GOOGLE'
  isServerConnected: false,
  isGoogleConnected: false
};

// ==========================================
// 2. DOM ELEMENT REFERENCES
// ==========================================

const el = {
  body: document.body,
  connectionStatus: document.getElementById('connection-status'),
  syncSpinner: document.getElementById('sync-spinner'),
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  themeDarkIcon: document.getElementById('theme-dark-icon'),
  themeLightIcon: document.getElementById('theme-light-icon'),
  syncCenterBtn: document.getElementById('sync-center-btn'),
  inboxToggleBtn: document.getElementById('inbox-toggle-btn'),
  inboxCount: document.getElementById('inbox-count'),
  
  // Lists and Counts
  listQ1: document.getElementById('list-q1'),
  listQ2: document.getElementById('list-q2'),
  listQ3: document.getElementById('list-q3'),
  listQ4: document.getElementById('list-q4'),
  listInbox: document.getElementById('inbox-task-list'),
  
  countQ1: document.getElementById('count-q1'),
  countQ2: document.getElementById('count-q2'),
  countQ3: document.getElementById('count-q3'),
  countQ4: document.getElementById('count-q4'),
  
  // Sidebar & Overlay
  inboxSidebar: document.getElementById('inbox-sidebar'),
  inboxCloseBtn: document.getElementById('inbox-close-btn'),
  appOverlay: document.getElementById('app-overlay'),
  
  // Global Quick Add
  globalAddInput: document.getElementById('global-add-input'),
  globalAddBtn: document.getElementById('global-add-btn'),
  
  // Sync Center Modal & Elements
  syncModal: document.getElementById('sync-modal'),
  syncServerIpInput: document.getElementById('sync-server-ip'),
  syncKeyInput: document.getElementById('sync-key'),
  generateKeyBtn: document.getElementById('generate-key-btn'),
  testConnectionBtn: document.getElementById('test-connection-btn'),
  wifiSyncNowBtn: document.getElementById('wifi-sync-now-btn'),
  
  // Google Sync Elements
  googleClientIdInput: document.getElementById('google-client-id'),
  googleTasklistSelect: document.getElementById('google-tasklist-select'),
  googleTasklistGroup: document.getElementById('google-tasklist-group'),
  disconnectGoogleBtn: document.getElementById('disconnect-google-btn'),
  googleLoginBtn: document.getElementById('google-login-btn'),
  
  // QR Share
  generateQrBtn: document.getElementById('generate-qr-btn'),
  qrCodeImg: document.getElementById('qr-code-img'),
  qrPlaceholder: document.getElementById('qr-placeholder'),
  
  // File Backups
  exportBackupBtn: document.getElementById('export-backup-btn'),
  importBackupFile: document.getElementById('import-backup-file'),
  wipeLocalBtn: document.getElementById('wipe-local-btn'),
  
  // Task Edit Modal
  taskEditModal: document.getElementById('task-edit-modal'),
  editModalHeadline: document.getElementById('edit-modal-headline'),
  editTaskId: document.getElementById('edit-task-id'),
  editTaskTitle: document.getElementById('edit-task-title'),
  editTaskNotes: document.getElementById('edit-task-notes'),
  editTaskQuadrant: document.getElementById('edit-task-quadrant'),
  editTaskDue: document.getElementById('edit-task-due'),
  deleteTaskBtn: document.getElementById('delete-task-btn'),
  saveTaskBtn: document.getElementById('save-task-btn'),
  cancelEditBtn: document.getElementById('cancel-edit-btn')
};

// ==========================================
// 3. UTILITIES & HASHTAG PARSING
// ==========================================

/**
 * Generate a unique ID for local tasks.
 */
function generateUUID() {
  return 'local_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

/**
 * Parsers a task title to find Eisenhower quadrant tags.
 * Strips the tag out of the title for displaying, and returns the target quadrant.
 * @param {string} title
 * @returns {{cleanedTitle: string, quadrant: string|null}}
 */
function parseTitleTags(title) {
  let quadrant = null;
  const matches = [...title.matchAll(TAG_REGEX)];
  
  if (matches.length > 0) {
    const tag = matches[matches.length - 1][1].toLowerCase();
    if (tag === 'q1' || tag === 'do') quadrant = 'Q1';
    else if (tag === 'q2' || tag === 'schedule') quadrant = 'Q2';
    else if (tag === 'q3' || tag === 'delegate') quadrant = 'Q3';
    else if (tag === 'q4' || tag === 'eliminate') quadrant = 'Q4';
  }
  
  // Remove tags from the displayed title and tidy up white spaces
  const cleanedTitle = title.replace(TAG_REGEX, '').replace(/\s+/g, ' ').trim();
  return { cleanedTitle, quadrant };
}

/**
 * Formats a title for saving to Google Tasks by appending the corresponding tag.
 * @param {string} title Raw or cleaned title
 * @param {string} quadrant 'Q1' | 'Q2' | 'Q3' | 'Q4' | 'INBOX'
 * @returns {string} Formatted title with tag
 */
function formatTitleWithTag(title, quadrant) {
  const { cleanedTitle } = parseTitleTags(title);
  if (!quadrant || quadrant === 'INBOX') {
    return cleanedTitle;
  }
  const tag = QUADRANT_TAGS[quadrant];
  return `${cleanedTitle} ${tag}`;
}

/**
 * Formats an ISO due date for input fields (YYYY-MM-DD).
 */
function formatInputDate(dateStr) {
  if (!dateStr) return '';
  return dateStr.split('T')[0];
}

/**
 * Returns a relative date label (e.g. "Today", "Tomorrow", "Yesterday", "May 25")
 */
function getRelativeDateLabel(dateStr) {
  if (!dateStr) return '';
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);
  
  const diffTime = due.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Tomorrow';
  if (diffDays === -1) return 'Yesterday';
  
  const options = { month: 'short', day: 'numeric' };
  // Add year if different
  if (due.getFullYear() !== today.getFullYear()) {
    options.year = 'numeric';
  }
  return due.toLocaleDateString(undefined, options);
}

/**
 * Checks if a date is overdue.
 */
function isOverdue(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);
  return due.getTime() < today.getTime();
}

// ==========================================
// 4. STORAGE & SYNC ENGINE
// ==========================================

/**
 * Saves tasks list to local storage.
 */
function saveLocalTasks() {
  localStorage.setItem('zenmatrix_tasks', JSON.stringify(state.tasks));
}

/**
 * Loads tasks list from local storage.
 */
function loadLocalTasks() {
  const storedTasks = localStorage.getItem('zenmatrix_tasks');
  if (storedTasks) {
    try {
      state.tasks = JSON.parse(storedTasks);
    } catch (e) {
      console.error('Failed to parse cached tasks:', e);
      state.tasks = [];
    }
  } else {
    // Seed initial welcome tasks to look fully designed!
    state.tasks = [
      {
        id: generateUUID(),
        title: 'Review quarterly goals #schedule',
        notes: 'Take time to reflect on professional milestones and plan proactive milestones.',
        quadrant: 'Q2',
        due: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
        completed: false,
        updated: Date.now()
      },
      {
        id: generateUUID(),
        title: 'Fix critical database query error #do',
        notes: 'High priority bug impacting production transactions.',
        quadrant: 'Q1',
        due: new Date().toISOString().split('T')[0],
        completed: false,
        updated: Date.now()
      },
      {
        id: generateUUID(),
        title: 'Draft slides for team retro #delegate',
        notes: 'Ask Sarah if she can take point on gathering retroactive comments.',
        quadrant: 'Q3',
        due: new Date(Date.now() + 86400000).toISOString().split('T')[0],
        completed: false,
        updated: Date.now()
      },
      {
        id: generateUUID(),
        title: 'Unsubscribe from old newsletters #eliminate',
        notes: 'Clean up workspace clutter.',
        quadrant: 'Q4',
        due: null,
        completed: false,
        updated: Date.now()
      },
      {
        id: generateUUID(),
        title: 'Unassigned task from Google Tasks',
        notes: 'Drag this task from the Inbox drawer into a quadrant to assign it!',
        quadrant: 'INBOX',
        due: null,
        completed: false,
        updated: Date.now()
      }
    ];
    saveLocalTasks();
  }
}

// ==========================================
// 5. DUAL SYNC CORE (GOOGLE TASKS & LOCAL WI-FI)
// ==========================================

let tokenClient = null;

/**
 * Simple Toast visual notification.
 */
function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.style.position = 'fixed';
  toast.style.bottom = '2rem';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%) translateY(100px)';
  toast.style.background = isError ? 'rgba(239, 68, 68, 0.95)' : 'rgba(30, 41, 59, 0.95)';
  toast.style.color = '#fff';
  toast.style.padding = '0.75rem 1.5rem';
  toast.style.borderRadius = '50px';
  toast.style.fontSize = '0.9rem';
  toast.style.boxShadow = '0 10px 30px rgba(0,0,0,0.3)';
  toast.style.zIndex = '2000';
  toast.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
  toast.style.border = '1px solid rgba(255,255,255,0.08)';
  toast.textContent = message;
  
  document.body.appendChild(toast);
  
  // Trigger slide up
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(0)';
  }, 50);
  
  // Remove after 3.5 seconds
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(100px)';
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

/**
 * Updates UI to show connection status
 */
function updateConnectionStatus() {
  if (state.activeSyncMode === 'GOOGLE') {
    if (state.isGoogleConnected) {
      el.connectionStatus.textContent = state.activeTaskListTitle 
        ? `Google: ${state.activeTaskListTitle}`
        : 'Google Connected';
      el.connectionStatus.style.borderColor = '#10b981';
      el.connectionStatus.style.color = '#10b981';
      el.syncCenterBtn.style.borderColor = '#10b981';
    } else {
      el.connectionStatus.textContent = 'Google Offline';
      el.connectionStatus.style.borderColor = 'hsl(5, 90%, 60%)';
      el.connectionStatus.style.color = 'hsl(5, 90%, 60%)';
      el.syncCenterBtn.style.borderColor = 'hsl(5, 90%, 60%)';
    }
  } else if (state.activeSyncMode === 'WIFI') {
    if (state.isServerConnected) {
      el.connectionStatus.textContent = 'Wi-Fi Synced';
      el.connectionStatus.style.borderColor = '#0ea5e9';
      el.connectionStatus.style.color = '#0ea5e9';
      el.syncCenterBtn.style.borderColor = '#0ea5e9';
    } else if (state.syncKey && state.syncServerIp) {
      el.connectionStatus.textContent = 'Server Offline';
      el.connectionStatus.style.borderColor = 'hsl(5, 90%, 60%)';
      el.connectionStatus.style.color = 'hsl(5, 90%, 60%)';
      el.syncCenterBtn.style.borderColor = 'hsl(5, 90%, 60%)';
    } else {
      el.connectionStatus.textContent = 'Wi-Fi Offline';
      el.connectionStatus.style.borderColor = 'var(--border-color)';
      el.connectionStatus.style.color = 'var(--text-muted)';
      el.syncCenterBtn.style.borderColor = 'var(--border-color)';
    }
  } else {
    el.connectionStatus.textContent = 'Offline Mode';
    el.connectionStatus.style.borderColor = 'var(--border-color)';
    el.connectionStatus.style.color = 'var(--text-muted)';
    el.syncCenterBtn.style.borderColor = 'var(--border-color)';
  }
}

// ==========================================
// A. NATIVE LOCAL WI-FI SYNC ENGINE
// ==========================================

/**
 * Tests connection with the local sync server
 */
async function testServerConnection() {
  const ip = el.syncServerIpInput.value.trim();
  if (!ip) {
    showToast('Please enter a Server IP address', true);
    return;
  }
  
  showToast('Testing server connection...');
  try {
    const res = await fetch(`${ip}/sync/test`, { method: 'GET' });
    if (res.ok) {
      showToast('Server connected successfully!');
      state.isServerConnected = true;
      updateConnectionStatus();
    } else {
      throw new Error(`Status ${res.status}`);
    }
  } catch (err) {
    console.error('Server test failed:', err);
    showToast('Failed to connect to local server', true);
    state.isServerConnected = false;
    updateConnectionStatus();
  }
}

/**
 * Real-time Bidirectional local Wi-Fi sync.
 */
async function syncWithLocalServer(force = false) {
  if (state.isSyncing) return;
  if (!state.syncKey || !state.syncServerIp) {
    state.isServerConnected = false;
    updateConnectionStatus();
    return;
  }
  
  state.isSyncing = true;
  el.syncSpinner.style.display = 'flex';
  
  try {
    const url = `${state.syncServerIp}/sync/${state.syncKey}`;
    const res = await fetch(url, { method: 'GET' });
    
    if (!res.ok) {
      throw new Error(`Sync server returned status ${res.status}`);
    }
    
    const remoteData = await res.json();
    const remoteTasks = remoteData.tasks || [];
    const remoteTimestamp = remoteData.timestamp || 0;
    
    // Compare timestamps to decide merge direction
    if (remoteTimestamp > state.lastSyncTimestamp) {
      console.log('[SyncEngine] Remote is newer. Merging remote tasks.');
      
      // Merge remote tasks into local list
      let mergedTasks = [...state.tasks];
      
      for (const rTask of remoteTasks) {
        const localIdx = mergedTasks.findIndex(t => t.id === rTask.id);
        
        if (localIdx !== -1) {
          const localTask = mergedTasks[localIdx];
          // Take the newest version
          if ((rTask.updated || 0) > (localTask.updated || 0)) {
            mergedTasks[localIdx] = rTask;
          }
        } else {
          // Add completely new remote task
          mergedTasks.push(rTask);
        }
      }
      
      state.tasks = mergedTasks;
      state.lastSyncTimestamp = remoteTimestamp;
      localStorage.setItem('zenmatrix_last_sync', state.lastSyncTimestamp);
      saveLocalTasks();
      state.isServerConnected = true;
      updateConnectionStatus();
      showToast('Tasks synchronized from local server!');
      renderAll();
      
    } else if (remoteTimestamp < state.lastSyncTimestamp || force || hasNewerLocalTasks(remoteTasks)) {
      console.log('[SyncEngine] Local has changes. Uploading to server.');
      
      const payload = {
        tasks: state.tasks,
        timestamp: Date.now()
      };
      
      const uploadRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!uploadRes.ok) {
        throw new Error('Upload failed');
      }
      
      state.lastSyncTimestamp = payload.timestamp;
      localStorage.setItem('zenmatrix_last_sync', state.lastSyncTimestamp);
      state.isServerConnected = true;
      updateConnectionStatus();
      if (force) showToast('Sync pushed to local server.');
    } else {
      // Identical timestamps, up to date!
      state.isServerConnected = true;
      updateConnectionStatus();
    }
    
  } catch (err) {
    console.error('Local sync failed:', err);
    state.isServerConnected = false;
    updateConnectionStatus();
  } finally {
    state.isSyncing = false;
    el.syncSpinner.style.display = 'none';
  }
}

/**
 * Checks if local task list has newer modifications than remote tasks list.
 */
function hasNewerLocalTasks(remoteTasks) {
  if (state.tasks.length !== remoteTasks.length) return true;
  for (const localTask of state.tasks) {
    const remote = remoteTasks.find(t => t.id === localTask.id);
    if (!remote || (localTask.updated || 0) > (remote.updated || 0)) {
      return true;
    }
  }
  return false;
}

/**
 * Auto-sync background loop. Checks every 10 seconds.
 */
function startAutoSyncLoop() {
  setInterval(() => {
    if (state.activeSyncMode === 'WIFI' && state.syncKey && state.syncServerIp && !state.isSyncing) {
      syncWithLocalServer(false);
    }
  }, 10000);
}

// ==========================================
// B. GOOGLE TASKS API SYNC ENGINE
// ==========================================

/**
 * Checks if Google login token is valid.
 */
function checkGoogleTokenValidity() {
  if (state.googleAccessToken && state.googleTokenExpiry > Date.now()) {
    state.isGoogleConnected = true;
    updateConnectionStatus();
    return true;
  }
  state.isGoogleConnected = false;
  state.googleAccessToken = '';
  localStorage.removeItem('zenmatrix_access_token');
  updateConnectionStatus();
  return false;
}

/**
 * Initializes Google OAuth identity client.
 */
function initGoogleIdentityClient() {
  if (!state.googleClientId) {
    state.isGoogleConnected = false;
    updateConnectionStatus();
    return;
  }

  try {
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
      setTimeout(initGoogleIdentityClient, 500);
      return;
    }
    
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: state.googleClientId,
      scope: 'https://www.googleapis.com/auth/tasks',
      callback: (tokenResponse) => {
        if (tokenResponse.error !== undefined) {
          console.error('Google Sign-in Error:', tokenResponse);
          showToast('Google login failed', true);
          return;
        }
        
        state.googleAccessToken = tokenResponse.access_token;
        state.googleTokenExpiry = Date.now() + (tokenResponse.expires_in * 1000);
        state.isGoogleConnected = true;
        
        localStorage.setItem('zenmatrix_access_token', state.googleAccessToken);
        localStorage.setItem('zenmatrix_token_expiry', state.googleTokenExpiry);
        
        showToast('Successfully connected to Google!');
        updateConnectionStatus();
        
        // Fetch lists and sync
        syncWithGoogle();
      },
    });
  } catch (err) {
    console.error('Error initializing Google GSI client:', err);
  }
}

/**
 * Disconnects Google Tasks Cloud Sync.
 */
function disconnectGoogle() {
  state.isGoogleConnected = false;
  state.googleAccessToken = '';
  state.googleTaskListId = '';
  state.activeTaskListTitle = '';
  localStorage.removeItem('zenmatrix_access_token');
  localStorage.removeItem('zenmatrix_token_expiry');
  localStorage.removeItem('zenmatrix_tasklist_id');
  localStorage.removeItem('zenmatrix_tasklist_title');
  
  updateConnectionStatus();
  el.googleTasklistGroup.style.display = 'none';
  el.disconnectGoogleBtn.style.display = 'none';
  el.googleLoginBtn.querySelector('span').textContent = 'Connect Google';
  showToast('Google account disconnected');
  renderAll();
}

/**
 * Trigger OAuth login token retrieval popup.
 */
function connectGoogleAccount() {
  const inputId = el.googleClientIdInput.value.trim();
  if (!inputId) {
    showToast('Please enter your Google Client ID first!', true);
    return;
  }
  
  state.googleClientId = inputId;
  localStorage.setItem('zenmatrix_client_id', inputId);
  
  if (checkGoogleTokenValidity()) {
    syncWithGoogle();
    return;
  }

  if (tokenClient) {
    tokenClient.requestAccessToken({ prompt: 'consent' });
  } else {
    initGoogleIdentityClient();
    setTimeout(() => {
      if (tokenClient) tokenClient.requestAccessToken({ prompt: 'consent' });
      else showToast('Google OAuth library loading... Try again.', true);
    }, 600);
  }
}

/**
 * REST Client helper to query Google Tasks with Auth Header.
 */
async function googleApiFetch(url, options = {}) {
  if (!state.googleAccessToken) {
    throw new Error('No Google Access Token available');
  }
  
  options.headers = {
    ...options.headers,
    'Authorization': `Bearer ${state.googleAccessToken}`,
    'Content-Type': 'application/json'
  };
  
  const response = await fetch(url, options);
  
  if (response.status === 401) {
    disconnectGoogle();
    throw new Error('Google authentication expired. Please reconnect.');
  }
  
  if (!response.ok) {
    const errorBody = await response.text();
    console.error('Google API Error Response:', errorBody);
    throw new Error(`Google API returned status ${response.status}`);
  }
  
  if (response.status === 204) return null;
  return await response.json();
}

/**
 * Google Cloud tasks synchronization.
 */
async function syncWithGoogle() {
  if (state.isSyncing) return;
  if (!checkGoogleTokenValidity()) return;
  
  state.isSyncing = true;
  el.syncSpinner.style.display = 'flex';
  
  try {
    // Step 1: Ensure active tasklist exists
    let taskLists = await googleApiFetch('https://tasks.googleapis.com/v1/users/@me/lists');
    const lists = taskLists.items || [];
    
    // Find matching list or create a default "ZenMatrix"
    let targetList = null;
    if (state.googleTaskListId) {
      targetList = lists.find(l => l.id === state.googleTaskListId);
    }
    
    if (!targetList) {
      targetList = lists.find(l => l.title === 'ZenMatrix');
    }
    
    if (!targetList) {
      // Create new list
      targetList = await googleApiFetch('https://tasks.googleapis.com/v1/users/@me/lists', {
        method: 'POST',
        body: JSON.stringify({ title: 'ZenMatrix' })
      });
      showToast('Created Google Tasks list: ZenMatrix');
      
      // Refresh the lists to include the newly created one
      taskLists = await googleApiFetch('https://tasks.googleapis.com/v1/users/@me/lists');
    }
    
    state.googleTaskListId = targetList.id;
    state.activeTaskListTitle = targetList.title;
    localStorage.setItem('zenmatrix_tasklist_id', state.googleTaskListId);
    localStorage.setItem('zenmatrix_tasklist_title', state.activeTaskListTitle);
    
    state.isGoogleConnected = true;
    updateConnectionStatus();
    populateTaskListSelect(taskLists.items || [targetList]);
    
    // Step 2: Fetch remote tasks
    const remoteUrl = `https://tasks.googleapis.com/v1/lists/${state.googleTaskListId}/tasks?showCompleted=true&showHidden=true&maxResults=100`;
    const remoteTasksData = await googleApiFetch(remoteUrl);
    const remoteTasks = remoteTasksData.items || [];
    
    // Step 3: Merge algorithm
    let mergedTasks = [...state.tasks];
    
    for (const gTask of remoteTasks) {
      if (gTask.deleted) continue;
      
      const { cleanedTitle, quadrant } = parseTitleTags(gTask.title);
      const isCompleted = gTask.status === 'completed';
      const remoteUpdated = gTask.updated ? new Date(gTask.updated).getTime() : 0;
      
      // Look for existing local task matching Google Task ID
      let localIndex = mergedTasks.findIndex(t => t.googleTaskId === gTask.id);
      
      if (localIndex === -1) {
        localIndex = mergedTasks.findIndex(t => !t.googleTaskId && t.title === cleanedTitle);
      }
      
      if (localIndex !== -1) {
        const localTask = mergedTasks[localIndex];
        
        if (remoteUpdated > (localTask.updated || 0)) {
          // Google's version is newer
          mergedTasks[localIndex] = {
            ...localTask,
            googleTaskId: gTask.id,
            title: cleanedTitle,
            notes: gTask.notes || '',
            quadrant: quadrant || 'INBOX',
            due: formatInputDate(gTask.due),
            completed: isCompleted,
            updated: remoteUpdated
          };
        } else if (remoteUpdated < (localTask.updated || 0)) {
          // Local task is newer. Push update to Google Tasks.
          await syncLocalTaskToGoogle(localTask);
        } else {
          if (!localTask.googleTaskId) {
            localTask.googleTaskId = gTask.id;
          }
        }
      } else {
        // Completely new remote task. Add to local list.
        mergedTasks.push({
          id: generateUUID(),
          googleTaskId: gTask.id,
          title: cleanedTitle,
          notes: gTask.notes || '',
          quadrant: quadrant || 'INBOX',
          due: formatInputDate(gTask.due),
          completed: isCompleted,
          updated: remoteUpdated || Date.now()
        });
      }
    }
    
    // Push offline tasks that have never been uploaded to Google Tasks
    for (const localTask of mergedTasks) {
      if (!localTask.googleTaskId) {
        await syncLocalTaskToGoogle(localTask);
      }
    }
    
    state.tasks = mergedTasks;
    saveLocalTasks();
    showToast('Google tasks synced successfully!');
    
  } catch (err) {
    console.error('Failed to sync with Google Tasks API:', err);
    const errMsg = err.message || 'Unknown error';
    if (errMsg.includes('403')) {
      showToast('Sync Failed: Google Tasks API is NOT enabled in your Cloud Console!', true);
    } else {
      showToast(`Sync Failed: ${errMsg}`, true);
    }
    state.isGoogleConnected = false;
    updateConnectionStatus();
  } finally {
    state.isSyncing = false;
    el.syncSpinner.style.display = 'none';
    renderAll();
  }
}

/**
 * Creates or updates a specific task on Google Tasks in the background.
 */
async function syncLocalTaskToGoogle(localTask) {
  if (!state.googleAccessToken) return;
  
  const formattedTitle = formatTitleWithTag(localTask.title, localTask.quadrant);
  const taskBody = {
    title: formattedTitle,
    notes: localTask.notes || '',
    status: localTask.completed ? 'completed' : 'needsAction',
    due: localTask.due ? new Date(localTask.due).toISOString() : null
  };
  
  try {
    if (localTask.googleTaskId) {
      const url = `https://tasks.googleapis.com/v1/lists/${state.googleTaskListId}/tasks/${localTask.googleTaskId}`;
      const response = await googleApiFetch(url, {
        method: 'PATCH',
        body: JSON.stringify(taskBody)
      });
      localTask.updated = new Date(response.updated).getTime();
    } else {
      const url = `https://tasks.googleapis.com/v1/lists/${state.googleTaskListId}/tasks`;
      const response = await googleApiFetch(url, {
        method: 'POST',
        body: JSON.stringify(taskBody)
      });
      localTask.googleTaskId = response.id;
      localTask.updated = new Date(response.updated).getTime();
    }
  } catch (err) {
    console.error(`Failed to push task "${localTask.title}" to Google Tasks:`, err);
  }
}

/**
 * Deletes a task from Google Tasks.
 */
async function deleteGoogleTask(googleTaskId) {
  if (!state.googleAccessToken || !googleTaskId) return;
  try {
    const url = `https://tasks.googleapis.com/v1/lists/${state.googleTaskListId}/tasks/${googleTaskId}`;
    await googleApiFetch(url, { method: 'DELETE' });
  } catch (err) {
    console.error('Failed to delete Google task:', err);
  }
}

/**
 * Populates lists dropdown in Google settings tab.
 */
function populateTaskListSelect(lists) {
  el.googleTasklistSelect.innerHTML = '';
  lists.forEach(list => {
    const option = document.createElement('option');
    option.value = list.id;
    option.textContent = list.title;
    if (list.id === state.googleTaskListId) {
      option.selected = true;
    }
    el.googleTasklistSelect.appendChild(option);
  });
  
  el.googleTasklistGroup.style.display = 'flex';
  el.disconnectGoogleBtn.style.display = 'block';
}

/**
 * Unified CRUD background sync router.
 */
function triggerBackgroundSync(task = null, isDelete = false) {
  if (state.activeSyncMode === 'GOOGLE' && checkGoogleTokenValidity()) {
    if (isDelete && task && task.googleTaskId) {
      deleteGoogleTask(task.googleTaskId);
    } else if (task) {
      syncLocalTaskToGoogle(task);
    }
  } else if (state.activeSyncMode === 'WIFI' && state.syncKey && state.syncServerIp) {
    syncWithLocalServer(isDelete); // isDelete force pushes
  }
}

// ==========================================
// FILE BACKUP: EXPORT & IMPORT
// ==========================================

/**
 * Exports current tasks to a downloadable JSON file.
 */
function exportTasksToFile() {
  const payload = {
    tasks: state.tasks,
    exportedAt: new Date().toISOString(),
    version: '1.0'
  };
  
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `zenmatrix_backup_${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  
  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
  
  showToast('Task backup exported successfully!');
}

/**
 * Restores tasks from an uploaded JSON backup file.
 */
function importTasksFromFile(file) {
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = function(event) {
    try {
      const backup = JSON.parse(event.target.result);
      if (!backup.tasks || !Array.isArray(backup.tasks)) {
        showToast('Invalid backup file structure!', true);
        return;
      }
      
      if (confirm(`Do you want to merge ${backup.tasks.length} tasks from this backup file? Existing identical tasks will be updated.`)) {
        let merged = [...state.tasks];
        
        backup.tasks.forEach(bTask => {
          const existingIdx = merged.findIndex(t => t.id === bTask.id);
          if (existingIdx !== -1) {
            // Keep the newest
            if ((bTask.updated || 0) > (merged[existingIdx].updated || 0)) {
              merged[existingIdx] = bTask;
            }
          } else {
            merged.push(bTask);
          }
        });
        
        state.tasks = merged;
        saveLocalTasks();
        renderAll();
        showToast('Backup restored and merged!');
        
        // Push sync if connected
        if (state.syncKey && state.syncServerIp) {
          syncWithLocalServer(true);
        }
      }
    } catch (err) {
      console.error('Failed to import backup:', err);
      showToast('Malformed backup file!', true);
    }
  };
  reader.readAsText(file);
}

// ==========================================
// QR CODE SHARE & URI PARSING
// ==========================================

/**
 * Compresses task array and generates sharing QR Code.
 */
function generateQrCode() {
  if (state.tasks.length === 0) {
    showToast('Create some tasks first to share!', true);
    return;
  }
  
  showToast('Generating QR code...');
  
  // Minimize task structure to fit comfortably inside a standard QR code URL limit
  const minified = state.tasks.slice(0, 30).map(t => [
    t.title,
    t.notes || '',
    t.quadrant,
    t.due || '',
    t.completed ? 1 : 0
  ]);
  
  try {
    // Stringify and Base64 compress
    const jsonStr = JSON.stringify(minified);
    const compressed = btoa(encodeURIComponent(jsonStr));
    
    // Construct sharing link
    const importUrl = `${window.location.origin}${window.location.pathname}?import=${compressed}`;
    
    // Request QR Code from free public qr-code API
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(importUrl)}`;
    
    el.qrPlaceholder.style.display = 'none';
    el.qrCodeImg.src = qrUrl;
    el.qrCodeImg.style.display = 'block';
    
    showToast('QR Code generated successfully!');
  } catch (err) {
    console.error('Failed to compress QR data:', err);
    showToast('Failed to generate QR Code', true);
  }
}

/**
 * Checks for incoming import strings in URL queries on startup.
 */
function checkImportUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const importData = urlParams.get('import');
  
  if (importData) {
    try {
      const decoded = decodeURIComponent(atob(importData));
      const minified = JSON.parse(decoded);
      
      if (!Array.isArray(minified)) {
        showToast('Invalid shared data format', true);
        return;
      }
      
      const importedTasks = minified.map(arr => ({
        id: 'share_' + Math.random().toString(36).substr(2, 5) + '_' + Date.now(),
        title: arr[0],
        notes: arr[1],
        quadrant: arr[2],
        due: arr[3] || null,
        completed: arr[4] === 1,
        updated: Date.now()
      }));
      
      setTimeout(() => {
        const choice = confirm(`Import ${importedTasks.length} tasks shared via QR code?\n\nPress OK to MERGE into your list.\nPress Cancel to discard.`);
        
        if (choice) {
          // Merge imported tasks
          let merged = [...state.tasks];
          importedTasks.forEach(task => {
            // Match by title to avoid duplicating active work
            const exists = merged.some(t => t.title.toLowerCase() === task.title.toLowerCase());
            if (!exists) {
              merged.push(task);
            }
          });
          
          state.tasks = merged;
          saveLocalTasks();
          renderAll();
          showToast(`Successfully imported ${importedTasks.length} tasks!`);
          
          // Sync if enabled
          if (state.syncKey && state.syncServerIp) {
            syncWithLocalServer(true);
          }
        }
        
        // Clean URL parameters cleanly so it doesn't prompt on reload
        window.history.replaceState({}, document.title, window.location.pathname);
      }, 800);
      
    } catch (err) {
      console.error('Failed to import shared tasks from URL:', err);
      showToast('Malformed shared tasks data link', true);
    }
  }
}


// ==========================================
// 6. TASK CRUD OPERATIONS
// ==========================================

/**
 * Add a new task (Global or Quadrant Add).
 */
function addTask(title, specificQuadrant = null) {
  if (!title.trim()) return;
  
  // Parse tags
  const { cleanedTitle, quadrant: parsedQuadrant } = parseTitleTags(title);
  const targetQuadrant = specificQuadrant || parsedQuadrant || 'INBOX';
  
  const newTask = {
    id: generateUUID(),
    title: cleanedTitle,
    notes: '',
    quadrant: targetQuadrant,
    due: null,
    completed: false,
    updated: Date.now()
  };
  
  state.tasks.push(newTask);
  saveLocalTasks();
  renderAll();
  
  // Trigger background sync
  triggerBackgroundSync(newTask);
  
  showToast(`Added task to ${targetQuadrant === 'INBOX' ? 'Inbox' : targetQuadrant}`);
}

/**
 * Save edits to a task.
 */
function updateTask(id, updatedFields) {
  const taskIndex = state.tasks.findIndex(t => t.id === id);
  if (taskIndex === -1) return;
  
  const task = state.tasks[taskIndex];
  
  // If the title changed, let's parse any new hashtags just in case
  if (updatedFields.title && updatedFields.title !== task.title) {
    const { cleanedTitle, quadrant } = parseTitleTags(updatedFields.title);
    updatedFields.title = cleanedTitle;
    if (quadrant) {
      updatedFields.quadrant = quadrant;
    }
  }
  
  state.tasks[taskIndex] = {
    ...task,
    ...updatedFields,
    updated: Date.now()
  };
  
  saveLocalTasks();
  renderAll();
  
  // Trigger background sync
  triggerBackgroundSync(state.tasks[taskIndex]);
  
  showToast('Task updated');
}

/**
 * Toggle Task Completion status.
 */
function toggleTaskCompletion(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  
  task.completed = !task.completed;
  task.updated = Date.now();
  
  saveLocalTasks();
  renderAll();
  
  // Trigger background sync
  triggerBackgroundSync(task);
}

/**
 * Delete a task.
 */
function deleteTask(id) {
  const taskIndex = state.tasks.findIndex(t => t.id === id);
  if (taskIndex === -1) return;
  
  const task = state.tasks[taskIndex];
  state.tasks.splice(taskIndex, 1);
  saveLocalTasks();
  renderAll();
  
  // Trigger background sync
  triggerBackgroundSync(task, true);
  
  showToast('Task deleted');
}

// ==========================================
// 7. DRAG AND DROP ORCHESTRATION
// ==========================================

let draggedTaskId = null;

/**
 * Setup standard HTML5 drag and drop on lists and items.
 */
function initDragAndDrop() {
  // Add listeners to task list drop zones
  const dropzones = [el.listQ1, el.listQ2, el.listQ3, el.listQ4, el.listInbox];
  
  dropzones.forEach(zone => {
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      const quadrantCard = zone.closest('.quadrant') || zone;
      quadrantCard.classList.add('drag-over');
    });
    
    zone.addEventListener('dragleave', (e) => {
      const quadrantCard = zone.closest('.quadrant') || zone;
      // Ensure we are truly leaving the quadrant, not entering a child element
      if (!zone.contains(e.relatedTarget)) {
        quadrantCard.classList.remove('drag-over');
      }
    });
    
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      const quadrantCard = zone.closest('.quadrant') || zone;
      quadrantCard.classList.remove('drag-over');
      
      const taskId = e.dataTransfer.getData('text/plain') || draggedTaskId;
      const targetQuadrant = zone.dataset.quadrant;
      
      if (taskId && targetQuadrant) {
        moveTask(taskId, targetQuadrant);
      }
      draggedTaskId = null;
    });
  });
}

/**
 * Move task between quadrants.
 */
function moveTask(id, targetQuadrant) {
  const task = state.tasks.find(t => t.id === id);
  if (!task || task.quadrant === targetQuadrant) return;
  
  task.quadrant = targetQuadrant;
  task.updated = Date.now();
  
  saveLocalTasks();
  renderAll();
  
  // Trigger background sync
  triggerBackgroundSync(task);
  
  showToast(`Moved task to ${targetQuadrant === 'INBOX' ? 'Inbox' : targetQuadrant}`);
}

// ==========================================
// 8. HIGH-FIDELITY RENDER ENGINE
// ==========================================

/**
 * Render all tasks in their respective quadrants and lists.
 */
function renderAll() {
  // Clear lists
  const containers = {
    Q1: el.listQ1,
    Q2: el.listQ2,
    Q3: el.listQ3,
    Q4: el.listQ4,
    INBOX: el.listInbox
  };
  
  Object.values(containers).forEach(c => c.innerHTML = '');
  
  const counts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0, INBOX: 0 };
  
  // Sort tasks by updated desc (newest first)
  const sortedTasks = [...state.tasks].sort((a, b) => (b.updated || 0) - (a.updated || 0));
  
  sortedTasks.forEach(task => {
    const list = containers[task.quadrant];
    if (!list) return;
    
    counts[task.quadrant]++;
    
    const card = createTaskCard(task);
    list.appendChild(card);
  });
  
  // Update counts
  el.countQ1.textContent = counts.Q1;
  el.countQ2.textContent = counts.Q2;
  el.countQ3.textContent = counts.Q3;
  el.countQ4.textContent = counts.Q4;
  el.inboxCount.textContent = counts.INBOX;
  
  // Manage Inbox badge and list visibility
  if (counts.INBOX > 0) {
    el.inboxCount.style.display = 'inline-block';
  } else {
    el.inboxCount.style.display = 'none';
  }
  
  // Draw empty states
  const emptyStateMessages = {
    Q1: { title: 'Do list is empty', msg: 'No urgent or critical fires to put out right now.', icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' },
    Q2: { title: 'Schedule list is empty', msg: 'Perfect time to plan ahead and avoid future stress.', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
    Q3: { title: 'Delegate list is empty', msg: 'Nothing here! You are leading like a champion.', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z' },
    Q4: { title: 'Eliminate list is empty', msg: 'All distractions cleared. Excellent work!', icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16' },
    INBOX: { title: 'Inbox is empty', msg: 'All tasks have been successfully categorized.', icon: 'M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z' }
  };
  
  Object.keys(containers).forEach(quad => {
    if (counts[quad] === 0) {
      const container = containers[quad];
      const data = emptyStateMessages[quad];
      
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.innerHTML = `
        <svg fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="${data.icon}"></path>
        </svg>
        <h4 style="font-size: 0.95rem; font-weight: 600; margin-top: 0.5rem; color: var(--text-primary);">${data.title}</h4>
        <p>${data.msg}</p>
      `;
      container.appendChild(emptyDiv);
    }
  });
}

/**
 * Creates a DOM Task Card element.
 */
function createTaskCard(task) {
  const card = document.createElement('div');
  card.className = `task-card ${task.completed ? 'completed' : ''}`;
  card.draggable = true;
  card.dataset.id = task.id;
  
  // Due date rendering
  let dueHtml = '';
  if (task.due) {
    const isOver = isOverdue(task.due) && !task.completed;
    dueHtml = `
      <span class="task-due ${isOver ? 'overdue' : ''}">
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"></path>
        </svg>
        ${getRelativeDateLabel(task.due)}
      </span>
    `;
  }
  
  // Quadrant Tag label
  let tagHtml = '';
  if (task.quadrant && task.quadrant !== 'INBOX') {
    const labels = { Q1: 'DO', Q2: 'SCHEDULE', Q3: 'DELEGATE', Q4: 'ELIMINATE' };
    tagHtml = `<span class="task-tag tag-${task.quadrant.toLowerCase()}">${labels[task.quadrant]}</span>`;
  }
  
  card.innerHTML = `
    <label class="checkbox-container">
      <input type="checkbox" ${task.completed ? 'checked' : ''} data-toggle-id="${task.id}">
      <span class="checkmark"></span>
    </label>
    
    <div class="task-content">
      <span class="task-title">${escapeHTML(task.title)}</span>
      ${task.notes ? `<p class="task-notes">${escapeHTML(task.notes)}</p>` : ''}
      <div class="task-meta">
        ${tagHtml}
        ${dueHtml}
      </div>
    </div>
    
    <div class="task-actions">
      <button class="task-btn edit-task-trigger" title="Edit details" data-edit-id="${task.id}">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125"></path>
        </svg>
      </button>
      <button class="task-btn task-btn-delete" title="Delete task" data-delete-id="${task.id}">
        <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
        </svg>
      </button>
    </div>
  `;
  
  // Card click should NOT trigger completion toggle, but checkbox will
  const checkbox = card.querySelector('input[type="checkbox"]');
  checkbox.addEventListener('change', () => {
    toggleTaskCompletion(task.id);
  });
  
  // Attach edit and delete events
  card.querySelector('.edit-task-trigger').addEventListener('click', (e) => {
    e.stopPropagation();
    openEditModal(task.id);
  });
  
  card.querySelector('.task-btn-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task.id);
  });
  
  // HTML5 Drag Event Setup
  card.addEventListener('dragstart', (e) => {
    draggedTaskId = task.id;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    
    // Auto-open Inbox Sidebar if dragging into or out of it
    if (task.quadrant === 'INBOX') {
      // Just keep sidebar open
    }
  });
  
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedTaskId = null;
  });
  
  // Quick double click to edit
  card.addEventListener('dblclick', () => {
    openEditModal(task.id);
  });
  
  return card;
}

/**
 * XSS Utility helper.
 */
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// ==========================================
// 9. MODALS & SIDEBAR CONTROLLERS
// ==========================================

function openModal(modal) {
  modal.classList.add('open');
  el.appOverlay.classList.add('open');
}

function closeModal() {
  const openModals = document.querySelectorAll('.modal.open');
  openModals.forEach(m => m.classList.remove('open'));
  el.appOverlay.classList.remove('open');
}

function openInbox() {
  el.inboxSidebar.classList.add('open');
  el.appOverlay.classList.add('open');
}

function closeInbox() {
  el.inboxSidebar.classList.remove('open');
  // Only close overlay if no modal is active
  if (!document.querySelector('.modal.open')) {
    el.appOverlay.classList.remove('open');
  }
}

/**
 * Open Task Editor Modal
 */
function openEditModal(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  
  el.editTaskId.value = task.id;
  el.editTaskTitle.value = task.title;
  el.editTaskNotes.value = task.notes || '';
  el.editTaskQuadrant.value = task.quadrant;
  el.editTaskDue.value = task.due ? formatInputDate(task.due) : '';
  
  el.editModalHeadline.textContent = `Edit Task (${task.quadrant})`;
  
  openModal(el.taskEditModal);
}

// ==========================================
// 10. SYSTEM EVENTS & INTEGRATION BOOTSTRAPPING
// ==========================================

function registerEventListeners() {
  // Tabbed Navigation Event Listeners
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Deactivate all tabs
      tabBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
      
      // Activate target tab
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      const targetContent = document.getElementById(tabId);
      
      if (tabId === 'tab-qr') {
        targetContent.style.display = 'flex';
      } else {
        targetContent.style.display = 'block';
      }
    });
  });

  // Sidebar Toggles
  el.inboxToggleBtn.addEventListener('click', openInbox);
  el.inboxCloseBtn.addEventListener('click', closeInbox);
  
  // Overlay Click closes sidebars and modals
  el.appOverlay.addEventListener('click', () => {
    closeInbox();
    closeModal();
  });
  
  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeInbox();
      closeModal();
    }
  });
  
  // Close triggers on Modals
  document.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', closeModal);
  });
  
  // Sync Center Modals open & saves
  el.syncCenterBtn.addEventListener('click', () => {
    el.syncServerIpInput.value = state.syncServerIp;
    el.syncKeyInput.value = state.syncKey;
    el.googleClientIdInput.value = state.googleClientId;
    
    // Auto-populate Google list select if logged in
    if (state.googleAccessToken && checkGoogleTokenValidity()) {
      el.googleTasklistGroup.style.display = 'flex';
      el.disconnectGoogleBtn.style.display = 'block';
    } else {
      el.googleTasklistGroup.style.display = 'none';
      el.disconnectGoogleBtn.style.display = 'none';
    }
    
    openModal(el.syncModal);
  });
  
  // Generate random sync key
  el.generateKeyBtn.addEventListener('click', () => {
    const randomKey = 'Z-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    el.syncKeyInput.value = randomKey;
    showToast('New Sync Key generated!');
  });
  
  // Server action listeners
  el.testConnectionBtn.addEventListener('click', testServerConnection);
  
  el.wifiSyncNowBtn.addEventListener('click', async () => {
    const ip = el.syncServerIpInput.value.trim();
    const key = el.syncKeyInput.value.trim();
    
    if (!ip || !key) {
      showToast('Please enter both Server IP and Sync Key', true);
      return;
    }
    
    state.syncServerIp = ip;
    state.syncKey = key;
    state.activeSyncMode = 'WIFI';
    
    localStorage.setItem('zenmatrix_sync_server', ip);
    localStorage.setItem('zenmatrix_sync_key', key);
    localStorage.setItem('zenmatrix_sync_mode', 'WIFI');
    
    showToast('Switched to Wi-Fi Sync mode!');
    await syncWithLocalServer(true);
    closeModal();
  });
  
  // Google OAuth Sync listeners
  el.googleLoginBtn.addEventListener('click', () => {
    state.activeSyncMode = 'GOOGLE';
    localStorage.setItem('zenmatrix_sync_mode', 'GOOGLE');
    connectGoogleAccount();
  });
  
  el.disconnectGoogleBtn.addEventListener('click', () => {
    state.activeSyncMode = 'OFFLINE';
    localStorage.setItem('zenmatrix_sync_mode', 'OFFLINE');
    disconnectGoogle();
    closeModal();
  });
  
  // Dropdown list switch triggers google sync automatically
  el.googleTasklistSelect.addEventListener('change', () => {
    state.googleTaskListId = el.googleTasklistSelect.value;
    const selectedOption = el.googleTasklistSelect.options[el.googleTasklistSelect.selectedIndex];
    state.activeTaskListTitle = selectedOption ? selectedOption.textContent : 'Google Task List';
    
    localStorage.setItem('zenmatrix_tasklist_id', state.googleTaskListId);
    localStorage.setItem('zenmatrix_tasklist_title', state.activeTaskListTitle);
    
    showToast(`Switched list to: ${state.activeTaskListTitle}`);
    syncWithGoogle();
  });
  
  // QR Share Actions
  el.generateQrBtn.addEventListener('click', generateQrCode);
  
  // File Backup Actions
  el.exportBackupBtn.addEventListener('click', exportTasksToFile);
  
  el.importBackupFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    importTasksFromFile(file);
    e.target.value = ''; // clear input cache
    closeModal();
  });
  
  // Wipe Database
  el.wipeLocalBtn.addEventListener('click', () => {
    if (confirm('DANGER! Wipe all local tasks permanently? This cannot be undone.')) {
      state.tasks = [];
      saveLocalTasks();
      renderAll();
      closeModal();
      showToast('Local database cleared.');
      
      triggerBackgroundSync(null, true); // Push empty database deletion
    }
  });
  
  // Quick Add Event Handlers
  el.globalAddBtn.addEventListener('click', () => {
    addTask(el.globalAddInput.value);
    el.globalAddInput.value = '';
  });
  
  el.globalAddInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      addTask(el.globalAddInput.value);
      el.globalAddInput.value = '';
    }
  });
  
  // Edit Modal Event Handlers
  el.saveTaskBtn.addEventListener('click', () => {
    const id = el.editTaskId.value;
    const title = el.editTaskTitle.value.trim();
    const notes = el.editTaskNotes.value.trim();
    const quadrant = el.editTaskQuadrant.value;
    const due = el.editTaskDue.value || null;
    
    if (!title) {
      showToast('Title is required!', true);
      return;
    }
    
    updateTask(id, { title, notes, quadrant, due });
    closeModal();
  });
  
  el.deleteTaskBtn.addEventListener('click', () => {
    const id = el.editTaskId.value;
    if (confirm('Delete this task permanently?')) {
      deleteTask(id);
      closeModal();
    }
  });
  
  // Theme Toggle Button
  el.themeToggleBtn.addEventListener('click', () => {
    document.documentElement.classList.toggle('light-mode');
    const isLight = document.documentElement.classList.contains('light-mode');
    
    if (isLight) {
      el.themeLightIcon.style.display = 'none';
      el.themeDarkIcon.style.display = 'block';
      localStorage.setItem('zenmatrix_theme', 'light');
    } else {
      el.themeLightIcon.style.display = 'block';
      el.themeDarkIcon.style.display = 'none';
      localStorage.setItem('zenmatrix_theme', 'dark');
    }
  });
}

/**
 * Loads system theme preferences.
 */
function initTheme() {
  const savedTheme = localStorage.getItem('zenmatrix_theme');
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  
  if (savedTheme === 'light' || (savedTheme === null && prefersLight)) {
    document.documentElement.classList.add('light-mode');
    el.themeLightIcon.style.display = 'none';
    el.themeDarkIcon.style.display = 'block';
  } else {
    document.documentElement.classList.remove('light-mode');
    el.themeLightIcon.style.display = 'block';
    el.themeDarkIcon.style.display = 'none';
  }
}

/**
 * Initializes and bootstraps the application
 */
window.addEventListener('DOMContentLoaded', () => {
  // Initialize Themes, Storage, & Event Listeners
  initTheme();
  loadLocalTasks();
  registerEventListeners();
  initDragAndDrop();
  renderAll();
  
  // Check for incoming shared task links from QR Code scans
  checkImportUrl();
  
  // Initialize Google SDK (pre-loads credentials if already entered)
  if (state.googleClientId) {
    initGoogleIdentityClient();
  }
  
  // Active Sync Onboarding boot routing
  if (state.activeSyncMode === 'GOOGLE') {
    if (state.googleAccessToken && checkGoogleTokenValidity()) {
      syncWithGoogle();
    } else {
      updateConnectionStatus();
    }
  } else if (state.activeSyncMode === 'WIFI') {
    if (state.syncKey && state.syncServerIp) {
      syncWithLocalServer(false);
      startAutoSyncLoop();
    } else {
      updateConnectionStatus();
    }
  } else {
    updateConnectionStatus();
  }

  // Register Service Worker for PWA Offline execution
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js')
        .then(reg => console.log('Service Worker registered successfully!', reg.scope))
        .catch(err => console.error('Service Worker registration failed:', err));
    });
  }
});
