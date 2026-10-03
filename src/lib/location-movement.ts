import type { LocationObject, MotionActivityObject } from 'expo-location';
import { detectMovement, estimateSpeed } from './movement';

let previous: LocationObject | undefined;
let motion: MotionActivityObject | null = null;

export function updateMotionActivity(value: MotionActivityObject | null) {
  motion = value;
}

export function resetLocationMovement() {
  previous = undefined;
  motion = null;
}

export function locationWithMovement(location: LocationObject) {
  const speed = estimateSpeed({ ...location.coords, timestamp: location.timestamp }, previous && { ...previous.coords, timestamp: previous.timestamp });
  if (!previous || location.timestamp > previous.timestamp) previous = location;
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracy: location.coords.accuracy,
    ...detectMovement(speed, location.timestamp, motion),
  };
}
