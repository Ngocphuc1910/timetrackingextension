/**
 * Background Service Worker for Focus Time Tracker Extension
 * Handles time tracking, tab management, and extension coordination
 */

// Utility Classes - Inline for Service Worker Compatibility

/**
 * Simple Storage Manager for Chrome Extension
 */
class StorageManager {
  constructor() {
    this.initialize();
  }

  async initialize() {
    // Ensure storage is initialized
    const storage = await chrome.storage.local.get(['settings', 'stats']);
    if (!storage.settings) {
      await this.saveSettings(this.getDefaultSettings());
    }
    if (!storage.stats) {
      const today = new Date().toISOString().split('T')[0];
      await chrome.storage.local.set({ 
        stats: {
          [today]: {
            totalTime: 0,
            sitesVisited: 0,
            productivityScore: 0,
            sites: {}
          }
        }
      });
    }
  }

  getDefaultSettings() {
    return {
      trackingEnabled: true,
      focusMode: false,
      workHours: { start: 9, end: 17 },
      breakReminders: true,
      productivityGoal: 6 * 60 * 60 * 1000 // 6 hours in milliseconds
    };
  }

  async saveTimeEntry(domain, timeSpent, visits = 1) {
    try {
      const today = new Date().toISOString().split('T')[0];
      const storage = await chrome.storage.local.get(['stats']);
      
      // Initialize today's stats if not exists
      if (!storage.stats || !storage.stats[today]) {
        storage.stats = {
          ...storage.stats,
          [today]: {
            totalTime: 0,
            sitesVisited: 0,
            productivityScore: 0,
            sites: {}
          }
        };
      }

      const stats = storage.stats[today];

      // Update domain stats
      if (!stats.sites[domain]) {
        stats.sites[domain] = {
          timeSpent: 0,
          visits: 0
        };
      }

      stats.sites[domain].timeSpent += timeSpent;
      stats.sites[domain].visits += visits;

      // Update total stats
      stats.totalTime = (stats.totalTime || 0) + timeSpent;
      stats.sitesVisited = Object.keys(stats.sites).length;

      // Calculate productivity score
      const productiveTime = Object.values(stats.sites)
        .reduce((total, site) => total + (site.timeSpent || 0), 0);
      stats.productivityScore = Math.min(
        Math.round((productiveTime / (6 * 60 * 60 * 1000)) * 100),
        100
      );

      // Save updated stats
      await chrome.storage.local.set({
        stats: {
          ...storage.stats,
          [today]: stats
        }
      });

      // Notify any open popups
      try {
        const message = {
          type: 'STATS_UPDATED',
          payload: stats
        };
        await chrome.runtime.sendMessage(message);
      } catch (error) {
        // Popup might not be open, ignore error
      }

      return stats;
    } catch (error) {
      console.error('Error saving time entry:', error);
      throw error;
    }
  }

  async getTodayStats() {
    const today = new Date().toISOString().split('T')[0];
    const storage = await chrome.storage.local.get(['stats']);
    return storage.stats?.[today] || {
      totalTime: 0,
      sitesVisited: 0,
      productivityScore: 0,
      sites: {}
    };
  }

  async getTopSites(limit = 5) {
    const stats = await this.getTodayStats();
    if (!stats.sites) return [];

    return Object.entries(stats.sites)
      .map(([domain, data]) => ({
        domain,
        ...data
      }))
      .sort((a, b) => b.timeSpent - a.timeSpent)
      .slice(0, limit);
  }

  async getSettings() {
    const result = await chrome.storage.local.get(['settings']);
    return result.settings || this.getDefaultSettings();
  }

  async saveSettings(settings) {
    await chrome.storage.local.set({ settings });
    return settings;
  }

  formatTime(ms) {
    if (ms < 1000) return '0s';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}h ${m % 60}m`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }
}

/**
 * Simple State Manager for Extension State
 */
class StateManager {
  constructor() {
    this.state = {
      currentSession: {
        domain: null,
        startTime: null,
        focusMode: false,
        isTracking: false
      },
      todayStats: {
        totalTime: 0,
        sitesVisited: 0,
        productivityScore: 0
      }
    };
    this.listeners = new Map();
  }

  async dispatch(action, payload = {}) {
    switch (action.type) {
      case 'START_TRACKING':
        this.state.currentSession = {
          domain: payload.domain,
          startTime: payload.startTime,
          isTracking: true
        };
        break;

      case 'STOP_TRACKING':
        this.state.currentSession = {
          domain: null,
          startTime: null,
          isTracking: false
        };
        break;

      case 'SET_FOCUS_MODE':
        this.state.currentSession.focusMode = payload.enabled;
        break;
    }

    // Notify listeners
    this.notifyListeners();
    return this.state;
  }

  subscribe(callback) {
    const id = Date.now().toString();
    this.listeners.set(id, callback);
    return id;
  }

  unsubscribe(id) {
    this.listeners.delete(id);
  }

  notifyListeners() {
    this.listeners.forEach(callback => callback(this.state));
  }

  getState() {
    return this.state;
  }
}

/**
 * Website Blocking Manager
 * Handles focus mode and site blocking using declarativeNetRequest API
 */
class BlockingManager {
  constructor() {
    this.focusMode = false;
    this.blockedSites = new Set();
    this.temporaryOverrides = new Map(); // domain -> expiry timestamp
    this.focusStartTime = null;
    this.blockedAttempts = 0;
    
    this.initialize();
  }

  async initialize() {
    try {
      // Load settings from storage
      const settings = await chrome.storage.local.get([
        'focusMode', 
        'blockedSites', 
        'focusStartTime',
        'blockedAttempts'
      ]);
      
      console.log('🔍 Loaded storage settings:', settings);
      
      this.focusMode = settings.focusMode || false;
      this.blockedSites = new Set(settings.blockedSites || []);
      this.focusStartTime = settings.focusStartTime || null;
      this.blockedAttempts = settings.blockedAttempts || 0;
      
      // IMPORTANT: Clear any existing blocking rules on initialization
      // This prevents orphaned rules from previous sessions
      await this.clearBlockingRules();
      
      // Update blocking rules if focus mode is active
      if (this.focusMode) {
        await this.updateBlockingRules();
      }
      
      console.log('🛡️ Blocking Manager initialized', {
        focusMode: this.focusMode,
        blockedSites: Array.from(this.blockedSites),
        focusStartTime: this.focusStartTime
      });
    } catch (error) {
      console.error('Error initializing BlockingManager:', error);
    }
  }

  /**
   * Toggle focus mode on/off
   */
  async toggleFocusMode() {
    try {
      this.focusMode = !this.focusMode;
      
      if (this.focusMode) {
        this.focusStartTime = Date.now();
        this.blockedAttempts = 0;
        await this.updateBlockingRules();
        console.log('🎯 Focus mode ENABLED');
      } else {
        this.focusStartTime = null;
        await this.clearBlockingRules();
        console.log('🎯 Focus mode DISABLED');
      }
      
      // Save state
      await this.saveState();
      
      return {
        success: true,
        focusMode: this.focusMode,
        focusStartTime: this.focusStartTime
      };
    } catch (error) {
      console.error('Error toggling focus mode:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Add a site to the blocked list
   */
  async addBlockedSite(domain) {
    try {
      if (!domain) return { success: false, error: 'Invalid domain' };
      
      // Clean domain
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      
      this.blockedSites.add(cleanDomain);
      await this.saveState();
      
      // Update rules if focus mode is active
      if (this.focusMode) {
        await this.updateBlockingRules();
      }
      
      console.log('➕ Added blocked site:', cleanDomain);
      return { success: true, domain: cleanDomain };
    } catch (error) {
      console.error('Error adding blocked site:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Remove a site from the blocked list
   */
  async removeBlockedSite(domain) {
    try {
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      
      this.blockedSites.delete(cleanDomain);
      await this.saveState();
      
      // Update rules if focus mode is active
      if (this.focusMode) {
        await this.updateBlockingRules();
      }
      
      console.log('➖ Removed blocked site:', cleanDomain);
      return { success: true, domain: cleanDomain };
    } catch (error) {
      console.error('Error removing blocked site:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Set temporary override for a domain
   */
  async setTemporaryOverride(domain, duration = 300000) { // 5 minutes default
    try {
      const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
      const expiryTime = Date.now() + duration;
      
      this.temporaryOverrides.set(cleanDomain, expiryTime);
      
      // Update blocking rules to exclude this domain temporarily
      if (this.focusMode) {
        await this.updateBlockingRules();
      }
      
      // Set timeout to remove override
      setTimeout(() => {
        this.temporaryOverrides.delete(cleanDomain);
        if (this.focusMode) {
          this.updateBlockingRules();
        }
      }, duration);
      
      console.log(`⏱️ Temporary override set for ${cleanDomain} for ${duration/1000}s`);
      return { success: true, domain: cleanDomain, expiryTime };
    } catch (error) {
      console.error('Error setting temporary override:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if a domain should be blocked
   */
  shouldBlockDomain(domain) {
    if (!this.focusMode) return false;
    
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    
    // Check if there's a temporary override
    if (this.temporaryOverrides.has(cleanDomain)) {
      const expiryTime = this.temporaryOverrides.get(cleanDomain);
      if (Date.now() < expiryTime) {
        return false; // Override still active
      } else {
        this.temporaryOverrides.delete(cleanDomain); // Expired override
      }
    }
    
    return this.blockedSites.has(cleanDomain);
  }

  /**
   * Update Chrome declarativeNetRequest rules
   */
  async updateBlockingRules() {
    try {
      // First, get and remove all existing dynamic rules
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const existingRuleIds = existingRules.map(rule => rule.id);
      
      if (existingRuleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: existingRuleIds
        });
        console.log(`🧹 Removed ${existingRuleIds.length} existing blocking rules`);
      }
      
      // If focus mode is off or no sites to block, we're done
      if (!this.focusMode || this.blockedSites.size === 0) {
        console.log('🔓 Focus mode disabled or no sites to block');
        return;
      }
      
      // Create new rules for blocked sites
      const rules = [];
      let ruleId = 1;
      
      // Add rules for each blocked site (skip those with temporary override)
      for (const domain of this.blockedSites) {
        // Skip if domain has temporary override
        if (this.temporaryOverrides.has(domain)) {
          const expiryTime = this.temporaryOverrides.get(domain);
          if (Date.now() < expiryTime) {
            console.log(`⏭️ Skipping ${domain} due to active override`);
            continue;
          } else {
            // Clean up expired override
            this.temporaryOverrides.delete(domain);
          }
        }
        
        // Add blocking rule for this domain
        rules.push({
          id: ruleId++,
          priority: 1,
          action: {
            type: "redirect",
            redirect: { extensionPath: "/blocked.html" }
          },
          condition: {
            urlFilter: `*://*.${domain}/*`,
            resourceTypes: ["main_frame"]
          }
        });
        
        // Also block the domain without www
        rules.push({
          id: ruleId++,
          priority: 1,
          action: {
            type: "redirect",
            redirect: { extensionPath: "/blocked.html" }
          },
          condition: {
            urlFilter: `*://${domain}/*`,
            resourceTypes: ["main_frame"]
          }
        });
      }
      
      if (rules.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          addRules: rules
        });
        
        console.log(`🛡️ Added ${rules.length} blocking rules for ${this.blockedSites.size} domains:`, 
          Array.from(this.blockedSites));
      } else {
        console.log('⚠️ No rules to add (all sites have overrides)');
      }
    } catch (error) {
      console.error('❌ Error updating blocking rules:', error);
      throw error;
    }
  }

  /**
   * Clear all blocking rules
   */
  async clearBlockingRules() {
    try {
      // Get existing rules
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const ruleIds = existingRules.map(rule => rule.id);
      
      if (ruleIds.length > 0) {
        await chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: ruleIds
        });
        
        console.log(`🧹 Cleared ${ruleIds.length} blocking rules`);
      }
    } catch (error) {
      console.error('Error clearing blocking rules:', error);
    }
  }

  /**
   * Record a blocked attempt
   */
  recordBlockedAttempt(domain) {
    this.blockedAttempts++;
    this.saveState();
    console.log(`🚫 Blocked attempt to access: ${domain} (Total: ${this.blockedAttempts})`);
  }

  /**
   * Get focus session stats
   */
  getFocusStats() {
    const focusTime = this.focusStartTime ? Date.now() - this.focusStartTime : 0;
    
    return {
      focusMode: this.focusMode,
      focusTime: focusTime,
      focusStartTime: this.focusStartTime,
      blockedAttempts: this.blockedAttempts,
      blockedSites: Array.from(this.blockedSites),
      temporaryOverrides: Object.fromEntries(this.temporaryOverrides)
    };
  }

  /**
   * Save state to storage
   */
  async saveState() {
    try {
      await chrome.storage.local.set({
        focusMode: this.focusMode,
        blockedSites: Array.from(this.blockedSites),
        focusStartTime: this.focusStartTime,
        blockedAttempts: this.blockedAttempts
      });
    } catch (error) {
      console.error('Error saving blocking state:', error);
    }
  }

  /**
   * Get debug information for troubleshooting
   */
  getDebugInfo(domain) {
    const debugInfo = {
      domain,
      focusMode: this.focusMode,
      blockedSites: Array.from(this.blockedSites),
      blockedSitesCount: this.blockedSites.size,
      temporaryOverrides: Object.fromEntries(this.temporaryOverrides),
      shouldBeBlocked: this.shouldBlockDomain(domain),
      focusStartTime: this.focusStartTime,
      blockedAttempts: this.blockedAttempts
    };
    
    console.log('🐛 Debug Info for', domain, ':', debugInfo);
    return debugInfo;
  }

  /**
   * Reset blocking manager to clean state - useful for debugging
   */
  async resetBlockingState() {
    try {
      console.log('🧹 Resetting blocking state...');
      
      // Clear all blocking rules
      await this.clearBlockingRules();
      
      // Reset internal state
      this.focusMode = false;
      this.blockedSites.clear();
      this.temporaryOverrides.clear();
      this.focusStartTime = null;
      this.blockedAttempts = 0;
      
      // Clear storage
      await chrome.storage.local.remove(['focusMode', 'blockedSites', 'focusStartTime', 'blockedAttempts']);
      
      // Save clean state
      await this.saveState();
      
      console.log('✅ Blocking state reset successfully');
      return { success: true, message: 'Blocking state reset' };
    } catch (error) {
      console.error('❌ Error resetting blocking state:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get all blocked sites
   */
  getBlockedSites() {
    return Array.from(this.blockedSites);
  }
}

// Main Focus Time Tracker Class
class FocusTimeTracker {
  constructor() {
    this.stateManager = null;
    this.storageManager = null;
    this.blockingManager = null; // Add blocking manager
    this.currentSession = {
      tabId: null,
      domain: null,
      startTime: null,
      isActive: false
    };
    this.saveInterval = null;
    
    this.initialize();
  }

  /**
   * Initialize the background script
   */
  async initialize() {
    try {
      console.log('🚀 Initializing Focus Time Tracker...');
      
      // Initialize managers
      this.stateManager = new StateManager();
      this.storageManager = new StorageManager();
      this.blockingManager = new BlockingManager(); // Initialize blocking manager
      
      // Set up event listeners
      this.setupEventListeners();
      
      // Start tracking current tab
      await this.startTrackingCurrentTab();
      
      console.log('✅ Focus Time Tracker initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Focus Time Tracker:', error);
    }
  }

  /**
   * Set up Chrome extension event listeners
   */
  setupEventListeners() {
    // Tab events
    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.handleTabActivated(activeInfo);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.handleTabUpdated(tabId, changeInfo, tab);
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      this.handleTabRemoved(tabId);
    });

    // Window events
    chrome.windows.onFocusChanged.addListener((windowId) => {
      this.handleWindowFocusChanged(windowId);
    });

    // Message handling from popup and content scripts
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });

    // Set up periodic save every 30 seconds
    this.saveInterval = setInterval(() => {
      if (this.currentSession.isActive) {
        this.saveCurrentSession();
      }
    }, 30000); // Save every 30 seconds for more frequent updates
  }

  /**
   * Handle tab activation (user switches to different tab)
   */
  async handleTabActivated(activeInfo) {
    try {
      console.log('🔄 Tab activated:', activeInfo.tabId);
      
      // Stop tracking current tab
      await this.stopCurrentTracking();
      
      // Get new tab info
      const tab = await chrome.tabs.get(activeInfo.tabId);
      console.log('📍 New tab URL:', tab.url);
      
      // Start tracking new tab
      await this.startTracking(tab);
    } catch (error) {
      console.error('❌ Error handling tab activation:', error);
    }
  }

  /**
   * Handle tab updates (URL changes, loading states)
   */
  async handleTabUpdated(tabId, changeInfo, tab) {
    try {
      console.log('📝 Tab updated:', { tabId, status: changeInfo.status, url: tab.url });
      
      // Only track when tab is complete and is the active tab
      if (changeInfo.status === 'complete' && tab.active && tab.url) {
        const domain = this.extractDomain(tab.url);
        console.log('🌐 Extracted domain:', domain);
        
        // If domain changed, restart tracking
        if (this.currentSession.tabId === tabId && this.currentSession.domain !== domain) {
          console.log('🔄 Domain changed, restarting tracking');
          await this.stopCurrentTracking();
          await this.startTracking(tab);
        }
      }
    } catch (error) {
      console.error('❌ Error handling tab update:', error);
    }
  }

  /**
   * Handle tab removal
   */
  async handleTabRemoved(tabId) {
    try {
      if (this.currentSession.tabId === tabId) {
        await this.stopCurrentTracking();
      }
    } catch (error) {
      console.error('Error handling tab removal:', error);
    }
  }

  /**
   * Handle window focus changes
   */
  async handleWindowFocusChanged(windowId) {
    try {
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        // Browser lost focus
        await this.pauseTracking();
      } else {
        // Browser gained focus
        const tabs = await chrome.tabs.query({ active: true, windowId: windowId });
        if (tabs.length > 0) {
          await this.resumeTracking(tabs[0]);
        }
      }
    } catch (error) {
      console.error('Error handling window focus change:', error);
    }
  }

  /**
   * Handle messages from other extension components
   */
  async handleMessage(message, sender, sendResponse) {
    try {
      console.log('📨 Message received:', message.type);

      switch (message.type) {
        case 'GET_CURRENT_STATE':
          const currentState = await this.getCurrentState();
          const focusStats = this.blockingManager.getFocusStats(); // Add focus stats
          sendResponse({ 
            success: true, 
            data: { ...currentState, focusStats } 
          });
          break;

        case 'GET_TODAY_STATS':
          const stats = await this.storageManager.getTodayStats();
          sendResponse({ success: true, data: stats });
          break;

        case 'GET_TOP_SITES':
          const topSites = await this.storageManager.getTopSites(message.payload?.limit || 5);
          sendResponse({ success: true, data: topSites });
          break;

        case 'EXPORT_DATA':
          const exportResult = await this.exportData(message.payload?.format || 'json');
          sendResponse(exportResult);
          break;

        case 'ACTIVITY_DETECTED':
          await this.handleActivityDetected(sender.tab?.id);
          sendResponse({ success: true });
          break;

        // Blocking system messages
        case 'TOGGLE_FOCUS_MODE':
          const toggleResult = await this.blockingManager.toggleFocusMode();
          await this.stateManager.dispatch({
            type: 'FOCUS_MODE_CHANGED',
            payload: { focusMode: toggleResult.focusMode }
          });
          sendResponse(toggleResult);
          break;

        case 'ADD_BLOCKED_SITE':
          const addResult = await this.blockingManager.addBlockedSite(message.payload?.domain);
          sendResponse(addResult);
          break;

        case 'REMOVE_BLOCKED_SITE':
          const removeResult = await this.blockingManager.removeBlockedSite(message.payload?.domain);
          sendResponse(removeResult);
          break;

        case 'BLOCK_CURRENT_SITE':
        case 'BLOCK_SITE': // Add alias for backward compatibility
          try {
            // Get the current active tab
            const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tabs.length > 0 && tabs[0].url) {
              const currentDomain = this.extractDomain(tabs[0].url);
              if (currentDomain && this.isTrackableUrl(tabs[0].url)) {
                const blockResult = await this.blockingManager.addBlockedSite(currentDomain);
                sendResponse({ ...blockResult, domain: currentDomain });
              } else {
                sendResponse({ success: false, error: 'Current site cannot be blocked' });
              }
            } else {
              sendResponse({ success: false, error: 'No active tab found' });
            }
          } catch (error) {
            sendResponse({ success: false, error: 'Failed to get current tab: ' + error.message });
          }
          break;

        case 'GET_BLOCKED_SITES':
          const blockedSites = Array.from(this.blockingManager.blockedSites);
          sendResponse({ success: true, data: blockedSites });
          break;

        case 'OVERRIDE_BLOCK':
          const overrideResult = await this.blockingManager.setTemporaryOverride(
            message.payload?.domain, 
            message.payload?.duration
          );
          sendResponse(overrideResult);
          break;

        case 'GET_FOCUS_STATS':
          const focusStatsOnly = this.blockingManager.getFocusStats();
          sendResponse({ success: true, data: focusStatsOnly });
          break;

        case 'RECORD_BLOCKED_ATTEMPT':
          this.blockingManager.recordBlockedAttempt(message.payload?.domain);
          sendResponse({ success: true });
          break;

        case 'GET_SESSION_TIME':
          const sessionTime = this.blockingManager.focusStartTime 
            ? Date.now() - this.blockingManager.focusStartTime 
            : 0;
          sendResponse({ success: true, data: { sessionTime } });
          break;

        case 'GET_DEBUG_INFO':
          const debugInfo = this.blockingManager.getDebugInfo(message.payload?.domain);
          sendResponse({ success: true, data: debugInfo });
          break;

        case 'RESET_BLOCKING_STATE':
          const resetResult = await this.blockingManager.resetBlockingState();
          sendResponse(resetResult);
          break;

        // Enhanced Analytics Messages
        case 'GET_ANALYTICS_DATA':
          try {
            const period = message.payload?.period || 'week';
            const analyticsData = await this.storageManager.getAnalyticsData(period);
            sendResponse({ success: true, data: analyticsData });
          } catch (error) {
            console.error('Error getting analytics data:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'GET_PRODUCTIVITY_GOALS':
          try {
            const goals = await this.storageManager.getProductivityGoals();
            sendResponse({ success: true, data: goals });
          } catch (error) {
            console.error('Error getting productivity goals:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'UPDATE_GOAL_PROGRESS':
          try {
            const updateResult = await this.storageManager.updateGoalProgress(
              message.payload?.goalId,
              message.payload?.progress
            );
            sendResponse(updateResult);
          } catch (error) {
            console.error('Error updating goal progress:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'UPDATE_SITE_CATEGORY':
          try {
            const categoryResult = await this.storageManager.updateSiteCategory(
              message.payload?.domain,
              message.payload?.category
            );
            sendResponse(categoryResult);
          } catch (error) {
            console.error('Error updating site category:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'GET_SITE_CATEGORY':
          try {
            const category = this.storageManager.getSiteCategory(message.payload?.domain);
            sendResponse({ success: true, data: { category } });
          } catch (error) {
            console.error('Error getting site category:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'GET_CATEGORY_BREAKDOWN':
          try {
            const analyticsData = await this.storageManager.getAnalyticsData('week');
            sendResponse({ 
              success: true, 
              data: { 
                categories: analyticsData.categoryBreakdown,
                totalTime: analyticsData.summary.totalTime
              }
            });
          } catch (error) {
            console.error('Error getting category breakdown:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'GET_WEEKLY_STATS':
          try {
            const weeklyData = await this.storageManager.getAnalyticsData('week');
            sendResponse({ success: true, data: weeklyData });
          } catch (error) {
            console.error('Error getting weekly stats:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        case 'GET_MONTHLY_STATS':
          try {
            const monthlyData = await this.storageManager.getAnalyticsData('month');
            sendResponse({ success: true, data: monthlyData });
          } catch (error) {
            console.error('Error getting monthly stats:', error);
            sendResponse({ success: false, error: error.message });
          }
          break;

        default:
          console.warn('❓ Unknown message type:', message.type);
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (error) {
      console.error('❌ Error handling message:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Handle activity detected from content script
   */
  async handleActivityDetected(tabId) {
    try {
      // If tracking was paused, resume it
      if (!this.currentSession.isActive && this.currentSession.tabId === tabId) {
        const tab = await chrome.tabs.get(tabId);
        await this.resumeTracking(tab);
      }
    } catch (error) {
      console.error('Error handling activity:', error);
    }
  }

  /**
   * Start tracking a website
   */
  async startTracking(tab) {
    try {
      console.log('🎯 startTracking called with tab:', { id: tab.id, url: tab.url });
      
      if (!tab || !tab.url || !this.isTrackableUrl(tab.url)) {
        console.log('⚠️ Tab not trackable:', { 
          hasTab: !!tab, 
          hasUrl: !!tab?.url, 
          isTrackable: tab?.url ? this.isTrackableUrl(tab.url) : false 
        });
        return;
      }

      // Save current session if exists
      if (this.currentSession.isActive) {
        await this.stopCurrentTracking();
      }

      const domain = this.extractDomain(tab.url);
      const now = Date.now();

      console.log('✨ Starting tracking for domain:', domain);

      this.currentSession = {
        tabId: tab.id,
        domain: domain,
        startTime: now,
        isActive: true
      };

      await this.stateManager.dispatch({
        type: 'START_TRACKING',
        payload: {
          domain: domain,
          startTime: now
        }
      });

      console.log(`✅ Started tracking: ${domain}, Tab ID: ${tab.id}`);
    } catch (error) {
      console.error('❌ Error starting tracking:', error);
    }
  }

  /**
   * Stop tracking current website and save data
   */
  async stopCurrentTracking() {
    try {
      if (!this.currentSession.isActive || !this.currentSession.startTime) {
        return;
      }

      const now = Date.now();
      const timeSpent = now - this.currentSession.startTime;
      const domain = this.currentSession.domain;

      // Only save if spent more than 1 second
      if (timeSpent > 1000 && domain) {
        await this.storageManager.saveTimeEntry(domain, timeSpent, 1);
        console.log(`Stopped tracking: ${domain}, Time: ${this.storageManager.formatTime(timeSpent)}`);
      }

      await this.stateManager.dispatch({
        type: 'STOP_TRACKING'
      });
      
      this.currentSession = {
        tabId: null,
        domain: null,
        startTime: null,
        isActive: false
      };
    } catch (error) {
      console.error('Error stopping tracking:', error);
    }
  }

  /**
   * Pause tracking (browser lost focus)
   */
  async pauseTracking() {
    if (this.currentSession.isActive) {
      const timeSpent = Date.now() - this.currentSession.startTime;
      if (timeSpent > 1000) {
        await this.storageManager.saveTimeEntry(this.currentSession.domain, timeSpent, 0);
      }
      this.currentSession.isActive = false;
      this.currentSession.startTime = null;
    }
  }

  /**
   * Resume tracking (browser gained focus)
   */
  async resumeTracking(tab) {
    if (!this.currentSession.isActive && tab && this.isTrackableUrl(tab.url)) {
      this.currentSession.startTime = Date.now();
      this.currentSession.isActive = true;
    }
  }

  /**
   * Get current extension state
   */
  async getCurrentState() {
    return {
      currentSession: this.currentSession,
      tracking: this.currentSession.isActive,
      focusMode: (await this.storageManager.getSettings()).focusMode,
      todayStats: await this.storageManager.getTodayStats()
    };
  }

  /**
   * Save current session progress
   */
  async saveCurrentSession() {
    try {
      if (this.currentSession.isActive && this.currentSession.startTime) {
        const timeSpent = Date.now() - this.currentSession.startTime;
        await this.storageManager.saveTimeEntry(this.currentSession.domain, timeSpent, 0);
      }
    } catch (error) {
      console.error('Error saving session:', error);
    }
  }

  /**
   * Extract domain from URL
   */
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch (error) {
      return 'unknown';
    }
  }

  /**
   * Check if URL should be tracked
   */
  isTrackableUrl(url) {
    const nonTrackableProtocols = ['chrome:', 'chrome-extension:', 'moz-extension:', 'about:', 'file:'];
    return !nonTrackableProtocols.some(protocol => url.startsWith(protocol));
  }

  /**
   * Export tracking data
   */
  async exportData(format = 'json') {
    try {
      const result = await chrome.storage.local.get(['timeData', 'settings']);
      const data = {
        timeData: result.timeData || {},
        settings: result.settings || {},
        exportDate: new Date().toISOString()
      };

      if (format === 'json') {
        return JSON.stringify(data, null, 2);
      }
      
      return data;
    } catch (error) {
      console.error('Error exporting data:', error);
      throw error;
    }
  }

  /**
   * Start tracking the currently active tab
   */
  async startTrackingCurrentTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs.length > 0) {
        console.log('🎯 Found active tab:', tabs[0].url);
        await this.startTracking(tabs[0]);
      } else {
        console.log('⚠️ No active tab found');
      }
    } catch (error) {
      console.error('❌ Error getting current tab:', error);
    }
  }
}

// Initialize the tracker when the service worker starts
const focusTimeTracker = new FocusTimeTracker(); 