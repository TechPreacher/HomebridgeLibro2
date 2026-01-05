// Unofficial plugin, not affiliated with PetLibro
// Use at your own risk
// Check PetLibro's ToS before use

const axios = require('axios');
const crypto = require('crypto');

let Service, Characteristic;

// Device type constants
const DEVICE_TYPE = {
  FEEDER: 'feeder',
  FOUNTAIN: 'fountain'
};

// Known fountain product names/models
const FOUNTAIN_IDENTIFIERS = [
  'PLWF', // Product code prefix for water fountains
  'Dockstream',
  'Fountain'
];

module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  
  homebridge.registerPlatform("homebridge-petlibro-2", "PetLibroPlatform", PetLibroPlatform);
};

// Helper function to determine device type
function getDeviceType(device) {
  const productName = device.productName || device.product_name || device.model || '';
  const deviceSn = device.deviceSn || device.device_id || device.deviceId || '';
  
  // Check if it's a fountain
  for (const identifier of FOUNTAIN_IDENTIFIERS) {
    if (productName.toLowerCase().includes(identifier.toLowerCase()) ||
        deviceSn.toUpperCase().startsWith(identifier.toUpperCase())) {
      return DEVICE_TYPE.FOUNTAIN;
    }
  }
  
  // Default to feeder
  return DEVICE_TYPE.FEEDER;
}

class PetLibroPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];
    this.deviceInstances = new Map(); // Track active device instances
    
    // Shared authentication state across all devices
    this.accessToken = null;
    this.refreshToken = null;
    this.tokenExpiry = null;
    
    // PetLibro API configuration
    this.email = this.config.email;
    this.password = this.config.password;
    this.baseUrl = this.config.apiEndpoint || 'https://api.us.petlibro.com';
    
    this.api.on('didFinishLaunching', () => {
      this.discoverDevices();
    });
  }
  
  configureAccessory(accessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }
  
  // Hash password like the HomeAssistant plugin does
  hashPassword(password) {
    return crypto.createHash('md5').update(password).digest('hex');
  }
  
  async authenticate() {
    if (!this.email || !this.password) {
      throw new Error('Email and password are required in config');
    }

    try {
      this.log('Authenticating with PetLibro API...');
      
      const payload = {
        appId: 1,
        appSn: 'c35772530d1041699c87fe62348507a8',
        country: this.config.country || 'US',
        email: this.email,
        password: this.hashPassword(this.password),
        phoneBrand: '',
        phoneSystemVersion: '',
        timezone: this.config.timezone || 'America/New_York',
        thirdId: null,
        type: null
      };
      
      const response = await axios.post(`${this.baseUrl}/member/auth/login`, payload, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'PetLibro/1.3.45',
          'Accept': 'application/json',
          'Accept-Language': 'en-US',
          'source': 'ANDROID',
          'language': 'EN',
          'timezone': payload.timezone,
          'version': '1.3.45'
        },
        timeout: 10000
      });
      
      const data = response.data;
      if (data && data.code === 0) {
        if (data.data && data.data.token) {
          this.accessToken = data.data.token;
          this.refreshToken = data.data.refresh_token || null;
          
          const expiresIn = data.data.expires_in || 3600;
          this.tokenExpiry = Date.now() + (expiresIn * 1000);
          
          this.log('Authentication successful!');
          return;
        } else {
          throw new Error('Authentication succeeded but no token found in data.token');
        }
      } else if (data && data.code) {
        const errorMsg = data.msg || data.message || 'Unknown error';
        throw new Error(`Authentication failed: ${errorMsg} (code: ${data.code})`);
      } else {
        throw new Error('Unexpected response format');
      }
      
    } catch (error) {
      this.log.error('Authentication failed:', error.message);
      if (error.response) {
        this.log.error('   Status:', error.response.status);
        this.log.error('   Data:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }
  
  async refreshAuthToken() {
    if (!this.refreshToken) {
      return this.authenticate();
    }
    
    try {
      const response = await axios.post(`${this.baseUrl}/member/auth/refresh`, {
        refresh_token: this.refreshToken
      }, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`
        }
      });
      
      if (response.data && response.data.access_token) {
        this.accessToken = response.data.access_token;
        this.tokenExpiry = Date.now() + (response.data.expires_in * 1000);
        this.log('Token refreshed successfully');
      }
    } catch (error) {
      this.log.warn('Token refresh failed, re-authenticating...');
      return this.authenticate();
    }
  }
  
  async ensureAuthenticated() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry) {
      await this.refreshAuthToken();
    }
  }
  
  // Fetch real-time device info (used for water level, etc.)
  async fetchDeviceRealInfo(deviceSn) {
    try {
      await this.ensureAuthenticated();
      
      const response = await axios.post(`${this.baseUrl}/device/device/realInfo`, {
        deviceSn: deviceSn
      }, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'token': this.accessToken,
          'source': 'ANDROID',
          'language': 'EN',
          'timezone': this.config.timezone || 'America/New_York',
          'version': '1.3.45'
        },
        timeout: 10000
      });
      
      if (response.data && response.data.code === 0 && response.data.data) {
        return response.data.data;
      }
      return null;
    } catch (error) {
      this.log.error(`Failed to fetch real info for ${deviceSn}:`, error.message);
      return null;
    }
  }
  
  async fetchDevicesFromAPI() {
    try {
      this.log('Fetching device list from PetLibro API...');
      await this.ensureAuthenticated();
      
      const response = await axios.post(`${this.baseUrl}/device/device/list`, {}, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
          'token': this.accessToken,
          'source': 'ANDROID',
          'language': 'EN',
          'timezone': this.config.timezone || 'America/New_York',
          'version': '1.3.45'
        },
        timeout: 10000
      });
      
      if (response.data && response.data.code === 0 && response.data.data) {
        const devices = response.data.data;
        
        if (Array.isArray(devices) && devices.length > 0) {
          this.log(`Found ${devices.length} device(s) in PetLibro account`);
          return devices;
        } else {
          this.log.warn('No devices found in PetLibro account');
          return [];
        }
      } else if (response.data && response.data.code !== 0) {
        const errorMsg = response.data.msg || 'Unknown error';
        throw new Error(`Device list API error: ${errorMsg} (code: ${response.data.code})`);
      } else {
        throw new Error('Unexpected response format from device list endpoint');
      }
      
    } catch (error) {
      this.log.error('Failed to get devices:', error.message);
      if (error.response) {
        this.log.error('   Status:', error.response.status);
        this.log.error('   Data:', JSON.stringify(error.response.data, null, 2));
      }
      throw error;
    }
  }
  
  async discoverDevices() {
    try {
      // Authenticate first
      await this.authenticate();
      
      // Fetch all devices from the API
      const devices = await this.fetchDevicesFromAPI();
      
      if (devices.length === 0) {
        this.log.warn('No devices found to configure');
        return;
      }
      
      // Track which UUIDs we found in the API
      const foundUUIDs = new Set();
      const newAccessories = [];
      
      // Create/update accessories for each device
      for (const device of devices) {
        const deviceSn = device.deviceSn || device.device_id || device.deviceId || device.id || device.serial;
        const deviceName = device.deviceName || device.device_name || device.name || 'PetLibro Device';
        const deviceModel = device.productName || device.product_name || device.model || 'Smart Device';
        const deviceType = getDeviceType(device);
        
        if (!deviceSn) {
          this.log.warn('Device found without serial number, skipping:', JSON.stringify(device));
          continue;
        }
        
        this.log.info(`Discovered ${deviceType}: ${deviceName} (${deviceModel}) - ${deviceSn}`);
        
        const uuid = this.api.hap.uuid.generate('petlibro-' + deviceType + '-' + deviceSn);
        foundUUIDs.add(uuid);
        
        const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
        
        if (existingAccessory) {
          this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
          // Update the context with latest device info
          existingAccessory.context.device = device;
          existingAccessory.context.deviceType = deviceType;
          
          if (deviceType === DEVICE_TYPE.FOUNTAIN) {
            new PetLibroFountain(this, existingAccessory, device);
          } else {
            new PetLibroFeeder(this, existingAccessory, device);
          }
          this.deviceInstances.set(uuid, existingAccessory);
        } else {
          this.log.info('Adding new accessory:', deviceName, `(${deviceSn})`);
          const accessory = new this.api.platformAccessory(deviceName, uuid);
          accessory.context.device = device;
          accessory.context.deviceType = deviceType;
          
          if (deviceType === DEVICE_TYPE.FOUNTAIN) {
            new PetLibroFountain(this, accessory, device);
          } else {
            new PetLibroFeeder(this, accessory, device);
          }
          newAccessories.push(accessory);
          this.deviceInstances.set(uuid, accessory);
        }
      }
      
      // Register all new accessories at once
      if (newAccessories.length > 0) {
        this.api.registerPlatformAccessories("homebridge-petlibro-2", "PetLibroPlatform", newAccessories);
        this.log.info(`Registered ${newAccessories.length} new accessory(s)`);
      }
      
      // Remove accessories that are no longer in the API
      const accessoriesToRemove = this.accessories.filter(accessory => !foundUUIDs.has(accessory.UUID));
      if (accessoriesToRemove.length > 0) {
        this.log.info(`Removing ${accessoriesToRemove.length} accessory(s) no longer in account`);
        this.api.unregisterPlatformAccessories("homebridge-petlibro-2", "PetLibroPlatform", accessoriesToRemove);
      }
      
    } catch (error) {
      this.log.error('Failed to discover devices:', error.message);
      // Don't throw - let Homebridge continue with other plugins
    }
  }
}

class PetLibroFeeder {
  constructor(platform, accessory, device) {
    this.platform = platform;
    this.accessory = accessory;
    this.log = platform.log;
    this.config = platform.config;
    this.device = device;
    
    // Extract device info
    this.deviceId = device.deviceSn || device.device_id || device.deviceId || device.id || device.serial;
    this.name = device.deviceName || device.device_name || device.name || 'Pet Feeder';
    this.model = device.productName || device.product_name || device.model || 'Smart Feeder';
    
    // Set accessory information
    this.accessory.getService(this.platform.api.hap.Service.AccessoryInformation)
      .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'PetLibro')
      .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.model)
      .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, this.deviceId || 'Unknown')
      .setCharacteristic(this.platform.api.hap.Characteristic.FirmwareRevision, device.firmwareVersion || device.firmware_version || '1.0.0');
    
    // Get or create the switch service
    this.switchService = this.accessory.getService(this.platform.api.hap.Service.Switch) 
      || this.accessory.addService(this.platform.api.hap.Service.Switch);
    
    this.switchService.setCharacteristic(this.platform.api.hap.Characteristic.Name, this.name);
    
    this.switchService.getCharacteristic(this.platform.api.hap.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));
    
    this.log.info(`Initialized feeder: ${this.name} (${this.deviceId})`);
  }
  
  async getOn() {
    // Always return false since this is a momentary switch for feeding
    return false;
  }
  
  async setOn(value) {
    if (value) {
      this.log(`[${this.name}] Feed button tapped! Triggering manual feeding...`);
      
      try {
        await this.triggerFeeding();
        this.log(`[${this.name}] Feeding command completed successfully`);
        
        // Reset switch to off after 1 second (momentary behavior)
        setTimeout(() => {
          this.switchService
            .getCharacteristic(this.platform.api.hap.Characteristic.On)
            .updateValue(false);
        }, 1000);
      } catch (error) {
        this.log.error(`[${this.name}] Failed to trigger feeding:`, error.message);
        
        // Reset switch to off immediately on error
        setTimeout(() => {
          this.switchService
            .getCharacteristic(this.platform.api.hap.Characteristic.On)
            .updateValue(false);
        }, 100);
      }
    }
  }
  
  async triggerFeeding() {
    await this.platform.ensureAuthenticated();
    
    if (!this.deviceId) {
      throw new Error('Device ID not found - cannot send feed command');
    }
    
    const portions = parseInt(this.config.portions || 1);
    this.log(`[${this.name}] Sending manual feed command (${portions} portion(s))`);
    
    const feedData = {
      deviceSn: this.deviceId,
      grainNum: portions,
      requestId: this.generateRequestId()
    };
    
    const response = await axios.post(`${this.platform.baseUrl}/device/device/manualFeeding`, feedData, {
      headers: {
        'Authorization': `Bearer ${this.platform.accessToken}`,
        'Content-Type': 'application/json',
        'token': this.platform.accessToken,
        'source': 'ANDROID',
        'language': 'EN',
        'timezone': this.config.timezone || 'America/New_York',
        'version': '1.3.45'
      },
      timeout: 15000
    });
    
    if (response.status === 200) {
      if (typeof response.data === 'number' || 
          (response.data && response.data.code === 0) ||
          response.data === 0) {
        this.log(`[${this.name}] Manual feeding triggered successfully!`);
        return;
      }
    }
    
    throw new Error(`Feed command failed with status ${response.status}`);
  }
  
  generateRequestId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
  
  getServices() {
    return [this.informationService, this.switchService];
  }
}

class PetLibroFountain {
  constructor(platform, accessory, device) {
    this.platform = platform;
    this.accessory = accessory;
    this.log = platform.log;
    this.config = platform.config;
    this.device = device;
    
    // Extract device info
    this.deviceId = device.deviceSn || device.device_id || device.deviceId || device.id || device.serial;
    this.name = device.deviceName || device.device_name || device.name || 'Water Fountain';
    this.model = device.productName || device.product_name || device.model || 'Smart Fountain';
    
    // Water level state
    this.waterLevel = 0;
    this.lastUpdate = null;
    
    // Polling interval (default: 5 minutes)
    this.pollingInterval = (this.config.fountainPollingInterval || 300) * 1000;
    
    // Set accessory information
    this.accessory.getService(this.platform.api.hap.Service.AccessoryInformation)
      .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'PetLibro')
      .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.model)
      .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, this.deviceId || 'Unknown')
      .setCharacteristic(this.platform.api.hap.Characteristic.FirmwareRevision, device.firmwareVersion || device.firmware_version || '1.0.0');
    
    // Get or create the humidity sensor service (used to display water level as percentage)
    this.humidityService = this.accessory.getService(this.platform.api.hap.Service.HumiditySensor) 
      || this.accessory.addService(this.platform.api.hap.Service.HumiditySensor);
    
    this.humidityService.setCharacteristic(this.platform.api.hap.Characteristic.Name, `${this.name} Water Level`);
    
    this.humidityService.getCharacteristic(this.platform.api.hap.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getWaterLevel.bind(this));
    
    // Remove any old switch service if it exists (in case device type changed)
    const existingSwitchService = this.accessory.getService(this.platform.api.hap.Service.Switch);
    if (existingSwitchService) {
      this.accessory.removeService(existingSwitchService);
    }
    
    this.log.info(`Initialized fountain: ${this.name} (${this.deviceId})`);
    
    // Initial water level fetch
    this.updateWaterLevel();
    
    // Start polling for water level updates
    this.startPolling();
  }
  
  async getWaterLevel() {
    // Return cached value, polling will update it
    return this.waterLevel;
  }
  
  async updateWaterLevel() {
    try {
      const realInfo = await this.platform.fetchDeviceRealInfo(this.deviceId);
      
      if (realInfo) {
        // Water level is stored as weightPercent (0-100)
        const weightPercent = realInfo.weightPercent;
        
        if (typeof weightPercent === 'number') {
          this.waterLevel = Math.min(100, Math.max(0, weightPercent));
          this.lastUpdate = new Date();
          
          // Update the HomeKit characteristic
          this.humidityService
            .getCharacteristic(this.platform.api.hap.Characteristic.CurrentRelativeHumidity)
            .updateValue(this.waterLevel);
          
          this.log.debug(`[${this.name}] Water level updated: ${this.waterLevel}%`);
        } else {
          this.log.debug(`[${this.name}] No water level data available in response`);
        }
      }
    } catch (error) {
      this.log.error(`[${this.name}] Failed to update water level:`, error.message);
    }
  }
  
  startPolling() {
    // Clear any existing interval
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }
    
    // Start new polling interval
    this.pollingTimer = setInterval(() => {
      this.updateWaterLevel();
    }, this.pollingInterval);
    
    this.log.info(`[${this.name}] Started water level polling (every ${this.pollingInterval / 1000}s)`);
  }
  
  stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }
  
  getServices() {
    return [this.informationService, this.humidityService];
  }
}