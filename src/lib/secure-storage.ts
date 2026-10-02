import * as SecureStore from 'expo-secure-store';

// Background location and geofence tasks must read keys while iOS is locked.
export const secureStorage = {
  getItemAsync: SecureStore.getItemAsync,
  deleteItemAsync: SecureStore.deleteItemAsync,
  setItemAsync: (key: string, value: string) => SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY }),
};
