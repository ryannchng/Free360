import { Redirect, useLocalSearchParams } from 'expo-router';
import Free360App from '../../App';

const validTabs = new Set(['map', 'circle', 'activity', 'you']);

export default function TabRoute() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  if (!tab || !validTabs.has(tab)) return <Redirect href="/map" />;
  return <Free360App />;
}
