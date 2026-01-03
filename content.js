/**
 * Instagram Unfollow Bot - Content Script
 * Runs on Instagram pages and handles the actual unfollowing automation
 */

// State
let isRunning = false;
let settings = {};
let sessionUnfollows = 0;
let sessionSkipped = 0;
let abortController = null;
let processedUsers = new Set(); // Track users we've already handled this session

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => {
        const timeout = setTimeout(resolve, ms);
        // Allow abort
        if (abortController) {
            abortController.signal.addEventListener('abort', () => {
                clearTimeout(timeout);
                resolve();
            });
        }
    });
}

/**
 * Get random delay between min and max (in seconds)
 */
function getRandomDelay(minSec, maxSec) {
    const min = minSec * 1000;
    const max = maxSec * 1000;
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Add small random variation to make timing more human-like
 */
function humanize(ms) {
    const variation = Math.random() * 0.2 - 0.1; // ±10%
    return Math.floor(ms * (1 + variation));
}

/**
 * Find all "Following" buttons on the page
 */
function findFollowingButtons() {
    // Find buttons by their text content since Instagram obfuscates class names
    const allButtons = Array.from(document.querySelectorAll('button'));
    return allButtons.filter(btn => {
        const text = btn.textContent?.trim();
        return text === 'Following';
    });
}

/**
 * Extract username for a Following button
 * Navigate the DOM to find the associated username
 */
function getUsernameForButton(button) {
    // Try to find the containing list item or row
    let container = button.closest('div[role="button"]')?.parentElement;

    // If that doesn't work, go up a few levels
    if (!container) {
        container = button.parentElement?.parentElement?.parentElement?.parentElement;
    }

    if (!container) {
        // Try alternative approach - look in ancestor divs
        let parent = button.parentElement;
        for (let i = 0; i < 10 && parent; i++) {
            const links = parent.querySelectorAll('a[href^="/"]');
            for (const link of links) {
                const href = link.getAttribute('href');
                // Filter out non-username links
                if (href && !href.includes('/explore/') && !href.includes('/p/') &&
                    !href.includes('/reel/') && !href.includes('/stories/')) {
                    const username = href.replace(/^\//, '').replace(/\/$/, '');
                    if (username && !username.includes('/')) {
                        return username;
                    }
                }
            }
            parent = parent.parentElement;
        }
        return null;
    }

    // Look for links that might contain the username
    const links = container.querySelectorAll('a[href^="/"]');
    for (const link of links) {
        const href = link.getAttribute('href');
        if (href && !href.includes('/explore/') && !href.includes('/p/') &&
            !href.includes('/reel/') && !href.includes('/stories/')) {
            const username = href.replace(/^\//, '').replace(/\/$/, '');
            if (username && !username.includes('/')) {
                return username;
            }
        }
    }

    // Try text content of links as fallback
    for (const link of links) {
        const text = link.textContent?.trim();
        if (text && text.length > 0 && text.length < 31 && !text.includes(' ')) {
            return text;
        }
    }

    return null;
}

/**
 * Check if username is in the ignore list
 */
function isIgnored(username) {
    if (!username || !settings.ignoreList) return false;
    const normalized = username.toLowerCase().replace(/^@/, '');
    return settings.ignoreList.some(u => u.toLowerCase() === normalized);
}

/**
 * Click the Following button and wait for confirmation modal
 */
async function clickFollowingButton(button) {
    // Count existing dialogs before clicking
    const dialogsBefore = document.querySelectorAll('[role="dialog"]').length;

    button.click();

    // Wait for a NEW modal to appear (confirmation modal)
    let confirmModal = null;
    for (let i = 0; i < 30; i++) {
        await sleep(100);

        const allDialogs = document.querySelectorAll('[role="dialog"]');

        // Look for a dialog containing "Unfollow" button
        for (const dialog of allDialogs) {
            const buttons = dialog.querySelectorAll('button');
            const hasUnfollow = Array.from(buttons).some(btn =>
                btn.textContent?.trim() === 'Unfollow'
            );
            if (hasUnfollow) {
                confirmModal = dialog;
                break;
            }
        }

        if (confirmModal) break;
    }

    if (!confirmModal) {
        throw new Error('Confirmation modal did not appear');
    }

    return confirmModal;
}

/**
 * Find and click the Unfollow button in the modal
 */
async function clickUnfollowInModal(modal) {
    // Wait longer for modal to fully render
    await sleep(humanize(1000));

    // Find the Unfollow button - try multiple strategies
    const buttons = Array.from(modal.querySelectorAll('button'));

    console.log('[Unfollow Bot] Found buttons in modal:', buttons.map(b => b.textContent?.trim()));

    // Strategy 1: Exact match for "Unfollow"
    let unfollowBtn = buttons.find(btn => {
        const text = btn.textContent?.trim();
        return text === 'Unfollow';
    });

    // Strategy 2: Check for red/destructive colored button (Instagram's unfollow is red)
    if (!unfollowBtn) {
        unfollowBtn = buttons.find(btn => {
            const style = window.getComputedStyle(btn);
            const color = style.color;
            // Instagram's red is usually rgb(237, 73, 86) or similar
            return color.includes('237') || color.includes('ed4956') ||
                btn.textContent?.toLowerCase().includes('unfollow');
        });
    }

    // Strategy 3: First button in modal that's not "Cancel" (usually the action button)
    if (!unfollowBtn) {
        unfollowBtn = buttons.find(btn => {
            const text = btn.textContent?.trim().toLowerCase();
            return text !== 'cancel' && text !== 'not now' && text.length > 0;
        });
    }

    if (!unfollowBtn) {
        throw new Error('Unfollow button not found in modal. Buttons: ' + buttons.map(b => b.textContent?.trim()).join(', '));
    }

    console.log('[Unfollow Bot] Clicking Unfollow button');
    unfollowBtn.click();

    // Wait for modal to close
    await sleep(humanize(500));
}

/**
 * Close any open modal (in case of errors)
 */
async function closeModal() {
    const modal = document.querySelector('[role="dialog"]');
    if (modal) {
        // Try clicking outside or pressing escape
        const closeBtn = modal.querySelector('button[aria-label="Close"]') ||
            modal.querySelector('svg[aria-label="Close"]')?.closest('button');
        if (closeBtn) {
            closeBtn.click();
        } else {
            // Press Escape
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }
        await sleep(300);
    }
}

/**
 * Scroll the page to load more users
 */
async function scrollToLoadMore() {
    // Find the scrollable container (usually the following modal/list)
    const scrollContainer = document.querySelector('[role="dialog"] [style*="overflow"]') ||
        document.querySelector('[role="dialog"]')?.querySelector('div[style*="height"]') ||
        document.querySelector('main');

    if (scrollContainer) {
        scrollContainer.scrollTop += 500;
    } else {
        window.scrollBy(0, 500);
    }

    // Wait for content to load
    await sleep(humanize(1000));
}

/**
 * Send message to popup
 */
function sendToPopup(message) {
    chrome.runtime.sendMessage(message).catch(() => {
        // Popup might be closed, that's okay
    });
}

/**
 * Main unfollow loop
 */
async function runUnfollowLoop() {
    sendToPopup({ type: 'log', text: 'Scanning for Following buttons...', level: 'info' });

    let consecutiveEmpty = 0;
    const maxConsecutiveEmpty = 3;

    while (isRunning) {
        // Check if we've hit the limit
        if (sessionUnfollows >= settings.maxUnfollows) {
            sendToPopup({
                type: 'complete',
                reason: `Reached limit of ${settings.maxUnfollows} unfollows`
            });
            break;
        }

        // Find Following buttons
        const buttons = findFollowingButtons();

        // Find the first button for a user we haven't processed yet
        let button = null;
        let username = null;

        for (const btn of buttons) {
            const user = getUsernameForButton(btn);
            if (user && !processedUsers.has(user.toLowerCase())) {
                button = btn;
                username = user;
                break;
            }
        }

        if (!button || !username) {
            consecutiveEmpty++;

            if (consecutiveEmpty >= maxConsecutiveEmpty) {
                sendToPopup({
                    type: 'complete',
                    reason: 'No more Following buttons found'
                });
                break;
            }

            // Try scrolling to load more
            if (settings.autoScroll) {
                sendToPopup({ type: 'log', text: 'No new users found, scrolling...', level: 'info' });
                await scrollToLoadMore();
            } else {
                await sleep(1000);
            }
            continue;
        }

        consecutiveEmpty = 0;

        // Mark this user as processed so we don't check them again
        processedUsers.add(username.toLowerCase());

        // Check ignore list
        if (isIgnored(username)) {
            sessionSkipped++;
            await chrome.storage.local.set({ sessionSkipped });
            sendToPopup({
                type: 'skipped',
                username,
                skippedCount: sessionSkipped
            });

            // Scroll past this user and continue to next
            button.scrollIntoView({ behavior: 'smooth', block: 'start' });
            await sleep(humanize(300));
            continue;
        }

        // Dry run mode
        if (settings.dryRun) {
            sessionUnfollows++;
            await chrome.storage.local.set({ sessionUnfollows });
            sendToPopup({
                type: 'dry-run',
                username,
                sessionCount: sessionUnfollows
            });

            // Scroll past and continue
            button.scrollIntoView({ behavior: 'smooth', block: 'start' });
            await sleep(humanize(500));
            continue;
        }

        // Actually unfollow
        try {
            sendToPopup({ type: 'log', text: `Unfollowing @${username}...`, level: 'info' });

            // Click Following button
            const modal = await clickFollowingButton(button);

            // Click Unfollow in modal
            await clickUnfollowInModal(modal);

            // Update counts
            sessionUnfollows++;
            const stored = await chrome.storage.local.get(['totalUnfollows']);
            const totalUnfollows = (stored.totalUnfollows || 0) + 1;
            await chrome.storage.local.set({ sessionUnfollows, totalUnfollows });

            sendToPopup({
                type: 'unfollowed',
                username,
                sessionCount: sessionUnfollows,
                totalCount: totalUnfollows
            });

        } catch (error) {
            sendToPopup({ type: 'error', error: `Failed to unfollow @${username}: ${error.message}` });
            await closeModal();

            // Scroll past the problematic button
            button.scrollIntoView({ behavior: 'smooth', block: 'center' });
            await sleep(500);
            continue;
        }

        // Wait before next unfollow (only if not at limit and still running)
        if (isRunning && sessionUnfollows < settings.maxUnfollows) {
            const delay = getRandomDelay(settings.minDelay, settings.maxDelay);
            const delaySec = Math.round(delay / 1000);
            sendToPopup({ type: 'waiting', seconds: delaySec });
            await sleep(delay);
        }
    }

    isRunning = false;
    await chrome.storage.local.set({ isRunning: false });
}

/**
 * Start the bot
 */
async function start(newSettings) {
    if (isRunning) {
        sendToPopup({ type: 'error', error: 'Bot is already running' });
        return;
    }

    settings = newSettings;
    isRunning = true;
    sessionUnfollows = 0;
    sessionSkipped = 0;
    processedUsers.clear(); // Reset processed users for new session
    abortController = new AbortController();

    await chrome.storage.local.set({
        isRunning: true,
        sessionUnfollows: 0,
        sessionSkipped: 0
    });

    // Check if we're on the right page
    if (!window.location.pathname.includes('/following')) {
        sendToPopup({
            type: 'log',
            text: 'Warning: Not on a /following page. Navigate there for best results.',
            level: 'warning'
        });
    }

    // Run the main loop
    try {
        await runUnfollowLoop();
    } catch (error) {
        sendToPopup({ type: 'error', error: `Unexpected error: ${error.message}` });
    }

    isRunning = false;
    abortController = null;
    await chrome.storage.local.set({ isRunning: false });
}

/**
 * Stop the bot
 */
async function stop() {
    isRunning = false;
    if (abortController) {
        abortController.abort();
        abortController = null;
    }
    await chrome.storage.local.set({ isRunning: false });
    sendToPopup({ type: 'log', text: 'Bot stopped by user', level: 'warning' });
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'start') {
        start(message.settings);
        sendResponse({ success: true });
    } else if (message.action === 'stop') {
        stop();
        sendResponse({ success: true });
    }
    return true;
});

// Check if we should resume on page load
(async function checkResume() {
    const result = await chrome.storage.local.get(['isRunning']);
    if (result.isRunning) {
        // Bot was running when page was reloaded - reset state
        await chrome.storage.local.set({ isRunning: false });
    }
})();

// Log that content script is loaded
console.log('[Unfollow Bot] Content script loaded on', window.location.href);
