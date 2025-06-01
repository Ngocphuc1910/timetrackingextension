/**
 * Storage Manager for Focus Time Tracker Extension
 * Handles data persistence with Chrome Storage API and provides mock data for development
 */

class StorageManager {
  constructor() {
    this.mockMode = true; // Set to false for production
    this.mockData = this.generateMockData();
  }

  /**
   * Generate realistic mock data for development and testing
   */
  generateMockData() {
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    return {
      dailyStats: {
        [today]: {
          totalTime: 14400000, // 4 hours in milliseconds
          sitesVisited: 8,
          sites: {
            'github.com': {
              domain: 'github.com',
              timeSpent: 5400000, // 1.5 hours
              visits: 12,
              lastVisit: Date.now() - 300000,
              category: 'productive'
            },
            'stackoverflow.com': {
              domain: 'stackoverflow.com',
              timeSpent: 3600000, // 1 hour
              visits: 8,
              lastVisit: Date.now() - 600000,
              category: 'productive'
            },
            'youtube.com': {
              domain: 'youtube.com',
              timeSpent: 2700000, // 45 minutes
              visits: 5,
              lastVisit: Date.now() - 1800000,
              category: 'entertainment'
            },
            'twitter.com': {
              domain: 'twitter.com',
              timeSpent: 1800000, // 30 minutes
              visits: 15,
              lastVisit: Date.now() - 900000,
              category: 'social'
            },
            'reddit.com': {
              domain: 'reddit.com',
              timeSpent: 900000, // 15 minutes
              visits: 3,
              lastVisit: Date.now() - 3600000,
              category: 'social'
            }
          },
          productivityScore: 72
        },
        [yesterday]: {
          totalTime: 12600000, // 3.5 hours
          sitesVisited: 6,
          sites: {
            'github.com': {
              domain: 'github.com',
              timeSpent: 7200000, // 2 hours
              visits: 10,
              lastVisit: Date.now() - 86400000,
              category: 'productive'
            },
            'docs.google.com': {
              domain: 'docs.google.com',
              timeSpent: 3600000, // 1 hour
              visits: 4,
              lastVisit: Date.now() - 86400000,
              category: 'productive'
            },
            'facebook.com': {
              domain: 'facebook.com',
              timeSpent: 1800000, // 30 minutes
              visits: 8,
              lastVisit: Date.now() - 86400000,
              category: 'social'
            }
          },
          productivityScore: 85
        }
      },
      settings: {
        blockedSites: ['facebook.com', 'twitter.com', 'instagram.com', 'tiktok.com'],
        trackingEnabled: true,
        focusMode: false,
        activityThreshold: 5000,
        dataRetentionDays: 30,
        integrationEnabled: false,
        pomodoroApiUrl: '',
        pomodoroApiKey: '',
        notifications: {
          dailyReport: true,
          focusReminders: true,
          breakReminders: false
        },
        categories: {
          'github.com': 'productive',
          'stackoverflow.com': 'productive',
          'docs.google.com': 'productive',
          'youtube.com': 'entertainment',
          'twitter.com': 'social',
          'facebook.com': 'social',
          'reddit.com': 'social',
          'instagram.com': 'social'
        }
      },
      weeklyStats: this.generateWeeklyMockData(),
      monthlyStats: this.generateMonthlyMockData()
    };
  }

  /**
   * Generate mock weekly statistics
   */
  generateWeeklyMockData() {
    const weeklyData = {};
    const today = new Date();
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      
      weeklyData[dateStr] = {
        totalTime: Math.floor(Math.random() * 18000000) + 3600000, // 1-5 hours
        productivityScore: Math.floor(Math.random() * 40) + 60, // 60-100
        topSites: this.generateRandomSiteStats(3)
      };
    }
    
    return weeklyData;
  }

  /**
   * Generate mock monthly statistics
   */
  generateMonthlyMockData() {
    const monthlyData = {};
    const today = new Date();
    
    for (let i = 0; i < 30; i++) {
      const date = new Date(today.getTime() - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      
      monthlyData[dateStr] = {
        totalTime: Math.floor(Math.random() * 18000000) + 1800000, // 0.5-5 hours
        productivityScore: Math.floor(Math.random() * 50) + 50 // 50-100
      };
    }
    
    return monthlyData;
  }

  /**
   * Generate random site statistics for mock data
   */
  generateRandomSiteStats(count) {
    const sites = ['github.com', 'stackoverflow.com', 'youtube.com', 'twitter.com', 'reddit.com'];
    const result = {};
    
    for (let i = 0; i < count; i++) {
      const site = sites[Math.floor(Math.random() * sites.length)];
      result[site] = {
        domain: site,
        timeSpent: Math.floor(Math.random() * 7200000) + 300000, // 5 min - 2 hours
        visits: Math.floor(Math.random() * 20) + 1
      };
    }
    
    return result;
  }

  /**
   * Save time entry for a specific domain
   */
  async saveTimeEntry(domain, timeSpent, visits = 1) {
    const today = new Date().toISOString().split('T')[0];
    
    if (this.mockMode) {
      // Update mock data
      if (!this.mockData.dailyStats[today]) {
        this.mockData.dailyStats[today] = {
          totalTime: 0,
          sitesVisited: 0,
          sites: {},
          productivityScore: 0
        };
      }
      
      const dayStats = this.mockData.dailyStats[today];
      const siteStats = dayStats.sites[domain] || {
        domain,
        timeSpent: 0,
        visits: 0,
        lastVisit: Date.now(),
        category: 'uncategorized'
      };
      
      siteStats.timeSpent += timeSpent;
      siteStats.visits += visits;
      siteStats.lastVisit = Date.now();
      
      dayStats.sites[domain] = siteStats;
      dayStats.totalTime += timeSpent;
      dayStats.sitesVisited = Object.keys(dayStats.sites).length;
      
      return siteStats;
    }
    
    // Real Chrome storage implementation
    try {
      const key = `dailyStats_${today}`;
      const result = await chrome.storage.local.get([key]);
      
      let dayStats = result[key] || {
        date: today,
        totalTime: 0,
        sitesVisited: 0,
        sites: {},
        productivityScore: 0
      };
      
      const siteStats = dayStats.sites[domain] || {
        domain,
        timeSpent: 0,
        visits: 0,
        lastVisit: Date.now(),
        category: 'uncategorized'
      };
      
      siteStats.timeSpent += timeSpent;
      siteStats.visits += visits;
      siteStats.lastVisit = Date.now();
      
      dayStats.sites[domain] = siteStats;
      dayStats.totalTime += timeSpent;
      dayStats.sitesVisited = Object.keys(dayStats.sites).length;
      
      await chrome.storage.local.set({ [key]: dayStats });
      return siteStats;
    } catch (error) {
      console.error('Failed to save time entry:', error);
      throw error;
    }
  }

  /**
   * Get time data for a specific date range
   */
  async getTimeData(startDate, endDate = null) {
    if (!endDate) {
      endDate = startDate;
    }
    
    if (this.mockMode) {
      const result = {};
      Object.keys(this.mockData.dailyStats).forEach(date => {
        if (date >= startDate && date <= endDate) {
          result[date] = this.mockData.dailyStats[date];
        }
      });
      return result;
    }
    
    // Real Chrome storage implementation
    try {
      const keys = [];
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      for (let date = start; date <= end; date.setDate(date.getDate() + 1)) {
        keys.push(`dailyStats_${date.toISOString().split('T')[0]}`);
      }
      
      const result = await chrome.storage.local.get(keys);
      return result;
    } catch (error) {
      console.error('Failed to get time data:', error);
      throw error;
    }
  }

  /**
   * Get today's statistics
   */
  async getTodayStats() {
    const today = new Date().toISOString().split('T')[0];
    const data = await this.getTimeData(today);
    
    if (this.mockMode) {
      return this.mockData.dailyStats[today] || {
        totalTime: 0,
        sitesVisited: 0,
        sites: {},
        productivityScore: 0
      };
    }
    
    return data[`dailyStats_${today}`] || {
      date: today,
      totalTime: 0,
      sitesVisited: 0,
      sites: {},
      productivityScore: 0
    };
  }

  /**
   * Get top sites for today
   */
  async getTopSites(limit = 5) {
    const todayStats = await this.getTodayStats();
    
    return Object.values(todayStats.sites || {})
      .sort((a, b) => b.timeSpent - a.timeSpent)
      .slice(0, limit);
  }

  /**
   * Update user settings
   */
  async updateSettings(newSettings) {
    if (this.mockMode) {
      this.mockData.settings = { ...this.mockData.settings, ...newSettings };
      return this.mockData.settings;
    }
    
    try {
      const result = await chrome.storage.local.get(['settings']);
      const currentSettings = result.settings || {};
      const updatedSettings = { ...currentSettings, ...newSettings };
      
      await chrome.storage.local.set({ settings: updatedSettings });
      return updatedSettings;
    } catch (error) {
      console.error('Failed to update settings:', error);
      throw error;
    }
  }

  /**
   * Get user settings
   */
  async getSettings() {
    if (this.mockMode) {
      return this.mockData.settings;
    }
    
    try {
      const result = await chrome.storage.local.get(['settings']);
      return result.settings || {
        blockedSites: [],
        trackingEnabled: true,
        focusMode: false,
        activityThreshold: 5000,
        dataRetentionDays: 30,
        integrationEnabled: false
      };
    } catch (error) {
      console.error('Failed to get settings:', error);
      throw error;
    }
  }

  /**
   * Get weekly statistics
   */
  async getWeeklyStats() {
    const endDate = new Date().toISOString().split('T')[0];
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    
    if (this.mockMode) {
      return this.mockData.weeklyStats;
    }
    
    return await this.getTimeData(startDate, endDate);
  }

  /**
   * Clean up old data based on retention settings
   */
  async cleanOldData() {
    const settings = await this.getSettings();
    const retentionDays = settings.dataRetentionDays || 30;
    const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];
    
    if (this.mockMode) {
      Object.keys(this.mockData.dailyStats).forEach(date => {
        if (date < cutoffDate) {
          delete this.mockData.dailyStats[date];
        }
      });
      return;
    }
    
    try {
      const allData = await chrome.storage.local.get(null);
      const keysToRemove = [];
      
      Object.keys(allData).forEach(key => {
        if (key.startsWith('dailyStats_')) {
          const date = key.replace('dailyStats_', '');
          if (date < cutoffDate) {
            keysToRemove.push(key);
          }
        }
      });
      
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
    } catch (error) {
      console.error('Failed to clean old data:', error);
      throw error;
    }
  }

  /**
   * Export data in JSON format
   */
  async exportData(format = 'json') {
    if (this.mockMode) {
      return JSON.stringify(this.mockData, null, 2);
    }
    
    try {
      const allData = await chrome.storage.local.get(null);
      
      switch (format) {
        case 'json':
          return JSON.stringify(allData, null, 2);
        case 'csv':
          return this.convertToCSV(allData);
        default:
          throw new Error(`Unsupported export format: ${format}`);
      }
    } catch (error) {
      console.error('Failed to export data:', error);
      throw error;
    }
  }

  /**
   * Convert data to CSV format
   */
  convertToCSV(data) {
    const csvRows = [];
    csvRows.push('Date,Domain,Time Spent (ms),Visits,Category');
    
    Object.keys(data).forEach(key => {
      if (key.startsWith('dailyStats_')) {
        const date = key.replace('dailyStats_', '');
        const dayStats = data[key];
        
        Object.values(dayStats.sites || {}).forEach(site => {
          csvRows.push([
            date,
            site.domain,
            site.timeSpent,
            site.visits,
            site.category || 'uncategorized'
          ].join(','));
        });
      }
    });
    
    return csvRows.join('\n');
  }

  /**
   * Import data from JSON
   */
  async importData(jsonData) {
    try {
      const data = JSON.parse(jsonData);
      
      if (this.mockMode) {
        this.mockData = { ...this.mockData, ...data };
        return true;
      }
      
      await chrome.storage.local.set(data);
      return true;
    } catch (error) {
      console.error('Failed to import data:', error);
      throw error;
    }
  }

  /**
   * Calculate productivity score based on time spent on different categories
   */
  calculateProductivityScore(sites) {
    const categoryWeights = {
      productive: 1.0,
      neutral: 0.5,
      entertainment: -0.3,
      social: -0.5,
      distraction: -1.0
    };
    
    let totalTime = 0;
    let weightedScore = 0;
    
    Object.values(sites).forEach(site => {
      const category = site.category || 'neutral';
      const weight = categoryWeights[category] || 0;
      
      totalTime += site.timeSpent;
      weightedScore += site.timeSpent * weight;
    });
    
    if (totalTime === 0) return 0;
    
    // Normalize to 0-100 scale
    const normalizedScore = (weightedScore / totalTime) * 50 + 50;
    return Math.max(0, Math.min(100, Math.round(normalizedScore)));
  }
}

// Export for use in different contexts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = StorageManager;
} else if (typeof window !== 'undefined') {
  window.StorageManager = StorageManager;
} 