/**
 * Instagram Unfollow Bot - Background Service Worker
 * Handles message routing and persistent state management
 */

// Listen for installation/update
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') {
        // Set default values on first install
        chrome.storage.local.set({
            totalUnfollows: 0,
            sessionUnfollows: 0,
            sessionSkipped: 0,
            isRunning: false,
            minDelay: 30,
            maxDelay: 90,
            maxUnfollows: 50,
            dryRun: false,
            autoScroll: true,
            ignoreList: []
        });

        console.log('[Unfollow Bot] Extension installed, defaults set');
    }
});

// Handle messages between popup and content scripts if needed
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Forward messages from content script to popup if popup is open
    // This is mainly for redundancy as direct messaging should work

    if (message.type === 'log' || message.type === 'unfollowed' ||
        message.type === 'skipped' || message.type === 'error' ||
        message.type === 'complete' || message.type === 'waiting' ||
        message.type === 'dry-run') {
        // These are content -> popup messages, just acknowledge
        sendResponse({ received: true });
    }

    return true;
});

// Keep service worker alive during operation (optional, for long operations)
// Note: Manifest V3 service workers have limited lifetime, but our
// automation runs in the content script which persists with the tab
