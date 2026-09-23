import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { loadCircle, publishLocation } from './circle';

export const BACKGROUND_LOCATION_TASK = 'free360-background-location';

// The root layout imports this module even when no screen is mounted.
TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[Free360] Background location error:', error.message);
    return;
  }
  const latest = data?.locations?.at(-1);
  if (!latest) return;
  try {
    await publishStoredLocation(latest);
  } catch (publishError) {
    console.warn('[Free360] Background location queued for retry:', publishError);
  }
});

export async function publishStoredLocation(location: Location.LocationObject) {
  const circle = await loadCircle();
  if (!circle) return;
  await publishLocation(circle, {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
  }, new Date(location.timestamp).toISOString());
}
