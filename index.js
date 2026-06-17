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

// Regional API endpoints. Upstream HA integration ships only US; EU is
// speculative but kept here so users on EU accounts can opt in via
// `region: "EU"` without forking. Falls back to US.
const API_REGIONS = {
  US: 'https://api.us.petlibro.com',
  EU: 'https://api.eu.petlibro.com'
};

// Coarse country -> region mapping; only used when neither `apiEndpoint`
// nor `region` is set in config. Anything not listed defaults to US.
const COUNTRY_TO_REGION = {
  AT: 'EU', BE: 'EU', BG: 'EU', CH: 'EU', CY: 'EU', CZ: 'EU', DE: 'EU',
  DK: 'EU', EE: 'EU', ES: 'EU', FI: 'EU', FR: 'EU', GB: 'EU', GR: 'EU',
  HR: 'EU', HU: 'EU', IE: 'EU', IT: 'EU', LT: 'EU', LU: 'EU', LV: 'EU',
  MT: 'EU', NL: 'EU', NO: 'EU', PL: 'EU', PT: 'EU', RO: 'EU', SE: 'EU',
  SI: 'EU', SK: 'EU', UK: 'EU'
};

function resolveBaseUrl(config) {
  if (config.apiEndpoint) return config.apiEndpoint;
  const region = (config.region || COUNTRY_TO_REGION[(config.country || '').toUpperCase()] || 'US').toUpperCase();
  return API_REGIONS[region] || API_REGIONS.US;
}

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
    this.tokenExpiry = null;
    
    // PetLibro API configuration
    this.email = this.config.email;
    this.password = this.config.password;
    this.baseUrl = resolveBaseUrl(this.config);
    
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
  
  async ensureAuthenticated() {
    if (!this.accessToken || !this.tokenExpiry || Date.now() >= this.tokenExpiry) {
      await this.authenticate();
    }
  }

  // Single entry point for all authenticated API calls.
  // Sends only `token` header (matches upstream HA integration).
  // On code 1009 (NOT_YET_LOGIN) the server has invalidated the token early
  // (commonly: another login on the same account); re-authenticate and retry once.
  async apiPost(path, body = {}, { timeout = 10000 } = {}) {
    await this.ensureAuthenticated();

    const buildHeaders = () => ({
      'Content-Type': 'application/json',
      'token': this.accessToken,
      'source': 'ANDROID',
      'language': 'EN',
      'timezone': this.config.timezone || 'America/New_York',
      'version': '1.3.45'
    });

    const url = `${this.baseUrl}${path}`;
    let response = await axios.post(url, body, { headers: buildHeaders(), timeout });

    if (response.data && response.data.code === 1009) {
      this.log.warn(`Token rejected by ${path} (code 1009 NOT_YET_LOGIN), re-authenticating...`);
      await this.authenticate();
      response = await axios.post(url, body, { headers: buildHeaders(), timeout });
    }

    return response;
  }

  // Fetch real-time device info (used for water level, etc.)
  async fetchDeviceRealInfo(deviceSn) {
    try {
      // Upstream HA integration sends both `id` and `deviceSn` for serial-keyed endpoints
      const response = await this.apiPost('/device/device/realInfo', {
        id: deviceSn,
        deviceSn: deviceSn
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
      const response = await this.apiPost('/device/device/list', {});

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

    const response = await this.platform.apiPost('/device/device/manualFeeding', feedData, { timeout: 15000 });

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
    this.waterLevel = 100;
    this.lastUpdate = null;
    
    // Polling interval (default: 5 minutes)
    this.pollingInterval = (this.config.fountainPollingInterval || 300) * 1000;
    
    // Set accessory information
    this.accessory.getService(this.platform.api.hap.Service.AccessoryInformation)
      .setCharacteristic(this.platform.api.hap.Characteristic.Manufacturer, 'PetLibro')
      .setCharacteristic(this.platform.api.hap.Characteristic.Model, this.model)
      .setCharacteristic(this.platform.api.hap.Characteristic.SerialNumber, this.deviceId || 'Unknown')
      .setCharacteristic(this.platform.api.hap.Characteristic.FirmwareRevision, device.firmwareVersion || device.firmware_version || '1.0.0');
    
    // Migrations: strip legacy/cross-type services from cached accessories
    // (prior versions used Battery; feeder->fountain type swaps leave a Switch behind)
    const existingBatteryService = this.accessory.getService(this.platform.api.hap.Service.Battery);
    if (existingBatteryService) {
      this.accessory.removeService(existingBatteryService);
    }
    const existingSwitchService = this.accessory.getService(this.platform.api.hap.Service.Switch);
    if (existingSwitchService) {
      this.accessory.removeService(existingSwitchService);
    }

    // HomeKit has no native fill-level characteristic. Sensor services are the
    // only ones that render as a visible tile in Apple Home; HumiditySensor's
    // 0-100% range maps directly onto water-reservoir percent. Mislabeled as
    // "Humidity" in Apple Home but the live value is visible at a glance.
    this.humidityService = this.accessory.getService(this.platform.api.hap.Service.HumiditySensor)
      || this.accessory.addService(this.platform.api.hap.Service.HumiditySensor);

    this.humidityService.setCharacteristic(this.platform.api.hap.Characteristic.Name, `${this.name} Water Level`);

    this.humidityService.getCharacteristic(this.platform.api.hap.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getWaterLevel.bind(this));
    
    this.log.info(`Initialized fountain: ${this.name} (${this.deviceId})`);
    
    // Initial water level fetch
    this.updateWaterLevel();
    
    // Start polling for water level updates
    this.startPolling();
  }
  
  async getWaterLevel() {
    // Return cached value; polling refreshes it
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

// Test-only exports. Production consumers must keep using the default export
// (the Homebridge `module.exports = function(homebridge)` initializer above).
module.exports._test = {
  getDeviceType,
  resolveBaseUrl,
  PetLibroPlatform,
  PetLibroFeeder,
  PetLibroFountain,
  DEVICE_TYPE,
  FOUNTAIN_IDENTIFIERS,
  API_REGIONS,
  COUNTRY_TO_REGION
};