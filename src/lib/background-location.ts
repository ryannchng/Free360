import type * as Location from 'expo-location';
import { loadCircle, publishLocation } from './circle';

export async function publishStoredLocation(location: Location.LocationObject) {
  const circle = await loadCircle();
  if (!circle) return;
  await publishLocation(circle, {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
  });
}
