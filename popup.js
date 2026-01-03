/**
 * Instagram Unfollow Bot - Popup Script
 * Handles UI interactions and messaging with content script
 */

// DOM Elements
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const statusIndicator = document.getElementById('status-indicator');
const sessionCount = document.getElementById('session-count');
const totalCount = document.getElementById('total-count');
const skippedCount = document.getElementById('skipped-count');
const minDelayInput = document.getElementById('min-delay');
const maxDelayInput = document.getElementById('max-delay');
const maxUnfollowsInput = document.getElementById('max-unfollows');
const dryRunCheckbox = document.getElementById('dry-run');
const autoScrollCheckbox = document.getElementById('auto-scroll');
const ignoreListTextarea = document.getElementById('ignore-list');
const ignoreCountSpan = document.getElementById('ignore-count');
const saveIgnoreBtn = document.getElementById('save-ignore-btn');
const clearIgnoreBtn = document.getElementById('clear-ignore-btn');
const activityLog = document.getElementById('activity-log');
const clearLogBtn = document.getElementById('clear-log-btn');

// State
let isRunning = false;

/**
 * Initialize popup - load saved settings and state
 */
async function init() {
  await loadSettings();
  await loadIgnoreList();
  await loadStats();
  await checkRunningState();
}

/**
 * Load settings from storage
 */
async function loadSettings() {
  const result = await chrome.storage.local.get([
    'minDelay', 'maxDelay', 'maxUnfollows', 'dryRun', 'autoScroll'
  ]);
  
  if (result.minDelay) minDelayInput.value = result.minDelay;
  if (result.maxDelay) maxDelayInput.value = result.maxDelay;
  if (result.maxUnfollows) maxUnfollowsInput.value = result.maxUnfollows;
  if (result.dryRun !== undefined) dryRunCheckbox.checked = result.dryRun;
  if (result.autoScroll !== undefined) autoScrollCheckbox.checked = result.autoScroll;
}

/**
 * Save settings to storage
 */
async function saveSettings() {
  await chrome.storage.local.set({
    minDelay: parseInt(minDelayInput.value) || 30,
    maxDelay: parseInt(maxDelayInput.value) || 90,
    maxUnfollows: parseInt(maxUnfollowsInput.value) || 50,
    dryRun: dryRunCheckbox.checked,
    autoScroll: autoScrollCheckbox.checked
  });
}

/**
 * Load ignore list from storage
 */
async function loadIgnoreList() {
  const result = await chrome.storage.local.get(['ignoreList']);
  if (result.ignoreList) {
    ignoreListTextarea.value = result.ignoreList.join('\n');
    updateIgnoreCount(result.ignoreList.length);
  }
}

/**
 * Save ignore list to storage
 */
async function saveIgnoreList() {
  const usernames = parseIgnoreList();
  await chrome.storage.local.set({ ignoreList: usernames });
  updateIgnoreCount(usernames.length);
  addLogEntry('Ignore list saved (' + usernames.length + ' usernames)', 'info');
}

/**
 * Parse ignore list textarea into array of usernames
 */
function parseIgnoreList() {
  return ignoreListTextarea.value
    .split('\n')
    .map(u => u.trim().toLowerCase().replace(/^@/, ''))
    .filter(u => u.length > 0);
}

/**
 * Update ignore count display
 */
function updateIgnoreCount(count) {
  ignoreCountSpan.textContent = `(${count})`;
}

/**
 * Clear ignore list
 */
async function clearIgnoreList() {
  ignoreListTextarea.value = '';
  await chrome.storage.local.set({ ignoreList: [] });
  updateIgnoreCount(0);
  addLogEntry('Ignore list cleared', 'warning');
}

/**
 * Load stats from storage
 */
async function loadStats() {
  const result = await chrome.storage.local.get(['totalUnfollows', 'sessionUnfollows', 'sessionSkipped']);
  totalCount.textContent = result.totalUnfollows || 0;
  sessionCount.textContent = result.sessionUnfollows || 0;
  skippedCount.textContent = result.sessionSkipped || 0;
}

/**
 * Check if bot is currently running
 */
async function checkRunningState() {
  const result = await chrome.storage.local.get(['isRunning']);
  isRunning = result.isRunning || false;
  updateUIState();
}

/**
 * Update UI based on running state
 */
function updateUIState() {
  if (isRunning) {
    startBtn.disabled = true;
    stopBtn.disabled = false;
    statusIndicator.textContent = 'Running';
    statusIndicator.className = 'status-badge status-running';
  } else {
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusIndicator.textContent = 'Idle';
    statusIndicator.className = 'status-badge status-idle';
  }
}

/**
 * Add entry to activity log
 */
function addLogEntry(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry log-${type}`;
  const timestamp = new Date().toLocaleTimeString();
  entry.textContent = `[${timestamp}] ${message}`;
  activityLog.insertBefore(entry, activityLog.firstChild);
  
  // Keep log from growing too large
  while (activityLog.children.length > 100) {
    activityLog.removeChild(activityLog.lastChild);
  }
}

/**
 * Clear activity log
 */
function clearLog() {
  activityLog.innerHTML = '<div class="log-entry log-info">Log cleared</div>';
}

/**
 * Start the unfollow bot
 */
async function startBot() {
  // Save current settings
  await saveSettings();
  await saveIgnoreList();
  
  // Reset session counters
  await chrome.storage.local.set({ 
    sessionUnfollows: 0, 
    sessionSkipped: 0,
    isRunning: true 
  });
  
  sessionCount.textContent = '0';
  skippedCount.textContent = '0';
  isRunning = true;
  updateUIState();
  
  // Get current tab and send start message
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab.url?.includes('instagram.com')) {
    addLogEntry('Not on Instagram! Navigate to your following page.', 'error');
    await stopBot();
    return;
  }
  
  // Get settings to send
  const settings = {
    minDelay: parseInt(minDelayInput.value) || 30,
    maxDelay: parseInt(maxDelayInput.value) || 90,
    maxUnfollows: parseInt(maxUnfollowsInput.value) || 50,
    dryRun: dryRunCheckbox.checked,
    autoScroll: autoScrollCheckbox.checked,
    ignoreList: parseIgnoreList()
  };
  
  addLogEntry('Starting bot... ' + (settings.dryRun ? '(DRY RUN)' : ''), 'success');
  
  // Send message to content script
  try {
    await chrome.tabs.sendMessage(tab.id, { 
      action: 'start', 
      settings 
    });
  } catch (error) {
    addLogEntry('Error: Could not connect to page. Try refreshing.', 'error');
    await stopBot();
  }
}

/**
 * Stop the unfollow bot
 */
async function stopBot() {
  await chrome.storage.local.set({ isRunning: false });
  isRunning = false;
  updateUIState();
  
  // Send stop message to content script
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'stop' });
    } catch (e) {
      // Content script might not be loaded
    }
  }
  
  addLogEntry('Bot stopped', 'warning');
  statusIndicator.textContent = 'Stopped';
  statusIndicator.className = 'status-badge status-stopped';
}

/**
 * Handle messages from content script
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'unfollowed':
      sessionCount.textContent = message.sessionCount;
      totalCount.textContent = message.totalCount;
      addLogEntry(`✓ Unfollowed @${message.username}`, 'success');
      break;
      
    case 'skipped':
      skippedCount.textContent = message.skippedCount;
      addLogEntry(`⊘ Skipped @${message.username} (in ignore list)`, 'skip');
      break;
      
    case 'dry-run':
      sessionCount.textContent = message.sessionCount;
      addLogEntry(`[DRY] Would unfollow @${message.username}`, 'info');
      break;
      
    case 'waiting':
      addLogEntry(`⏱ Waiting ${message.seconds}s before next...`, 'info');
      break;
      
    case 'error':
      addLogEntry(`✗ ${message.error}`, 'error');
      break;
      
    case 'complete':
      addLogEntry(`✓ Complete! ${message.reason}`, 'success');
      stopBot();
      break;
      
    case 'log':
      addLogEntry(message.text, message.level || 'info');
      break;
  }
  
  sendResponse({ received: true });
  return true;
});

// Event listeners
startBtn.addEventListener('click', startBot);
stopBtn.addEventListener('click', stopBot);
saveIgnoreBtn.addEventListener('click', saveIgnoreList);
clearIgnoreBtn.addEventListener('click', clearIgnoreList);
clearLogBtn.addEventListener('click', clearLog);

// Auto-save settings on change
[minDelayInput, maxDelayInput, maxUnfollowsInput].forEach(input => {
  input.addEventListener('change', saveSettings);
});

[dryRunCheckbox, autoScrollCheckbox].forEach(checkbox => {
  checkbox.addEventListener('change', saveSettings);
});

// Initialize
init();
