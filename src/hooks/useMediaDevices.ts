import { useState, useEffect, useCallback } from 'react';

export function useMediaDevices() {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [permissionGranted, setPermissionGranted] = useState(false);

  const fetchDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDevices([]);
      setPermissionGranted(false);
      return;
    }

    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = allDevices.filter(device => device.kind === 'videoinput');
      setDevices(videoDevices);
      
      // If labels are empty, it means we don't have permission yet.
      // But we don't want to trigger permission prompt just by listing.
      if (videoDevices.length > 0 && videoDevices[0].label !== '') {
        setPermissionGranted(true);
      }
    } catch (e) {
      console.warn('Error enumerating devices:', e);
    }
  }, []);

  useEffect(() => {
    fetchDevices();
    if (!navigator.mediaDevices?.addEventListener) {
      return;
    }
    navigator.mediaDevices.addEventListener('devicechange', fetchDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', fetchDevices);
  }, [fetchDevices]);

  return { devices, permissionGranted, fetchDevices };
}
