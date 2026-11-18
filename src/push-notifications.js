

import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';

async function setupPadmaNotifications() {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  try {
    // Listen for the FCM registration token.
    await PushNotifications.addListener('registration', (token) => {
      window.PADMA_FCM_TOKEN = token.value;

      // Store only the device notification token locally.
      try {
        localStorage.setItem('padma_fcm_token', token.value);
      } catch (error) {
        console.warn('Could not save notification token locally.');
      }

      console.log('PADMA FCM registration successful.');
      console.log('PADMA FCM TOKEN:', token.value);
    });

    await PushNotifications.addListener('registrationError', (error) => {
      console.error('PADMA notification registration failed:', error);
    });

    await PushNotifications.addListener(
      'pushNotificationReceived',
      (notification) => {
        console.log('PADMA notification received:', notification);
      }
    );

    await PushNotifications.addListener(
      'pushNotificationActionPerformed',
      (action) => {
        console.log('PADMA notification opened:', action);
      }
    );

    // Android 13+ requires notification permission.
    let permission = await PushNotifications.checkPermissions();

    if (permission.receive === 'prompt') {
      permission = await PushNotifications.requestPermissions();
    }

    if (permission.receive !== 'granted') {
      console.warn('PADMA notification permission was not granted.');
      return;
    }

    await PushNotifications.register();

    console.log('PADMA push notification registration requested.');
  } catch (error) {
    console.error('PADMA push setup error:', error);
  }
}

document.addEventListener('DOMContentLoaded', setupPadmaNotifications);
