import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';
import { BACKGROUND_LOCATION_TASK } from './src/lib/background-location';
import { type CheckIn, type CircleConfig, type CircleSnapshot, loadCircle, publishCheckIn, publishLocation, publishPaused, subscribeToCircle } from './src/lib/circle';

type Tab = 'map' | 'circle' | 'activity' | 'you';
type IconName = keyof typeof Ionicons.glyphMap;

type Member = {
  id: string;
  name: string;
  initials: string;
  role: string;
  status: string;
  lastSeen: string;
  coordinate: { latitude: number; longitude: number };
  color: string;
  battery: number;
  isYou?: boolean;
  isPaused?: boolean;
  isStale?: boolean;
};

const COLORS = {
  ink: '#16233B',
  muted: '#718099',
  subtle: '#9AA6B8',
  border: '#E6EAF0',
  canvas: '#F6F8FB',
  white: '#FFFFFF',
  coral: '#FF6E61',
  coralSoft: '#FFF0EE',
  mint: '#27B89A',
  mintSoft: '#E7F8F3',
  blue: '#4386F4',
  blueSoft: '#EDF4FF',
  yellow: '#F5B33F',
  yellowSoft: '#FFF5DC',
};

const INITIAL_REGION = {
  latitude: 40.742,
  longitude: -73.991,
  latitudeDelta: 0.024,
  longitudeDelta: 0.024,
};

const selfMember: Member = { id: 'you', name: 'You', initials: 'YO', role: 'You', status: 'Sharing paused', lastSeen: 'No location yet', coordinate: INITIAL_REGION, color: COLORS.coral, battery: 0, isYou: true };
const STALE_AFTER_MS = 5 * 60 * 1000;

function ageLabel(recordedAt: string, now: number) {
  const minutes = Math.max(0, Math.floor((now - Date.parse(recordedAt)) / 60000));
  if (minutes < 1) return 'Updated less than a minute ago';
  if (minutes < 60) return `Updated ${minutes} min ago`;
  return `Updated ${Math.floor(minutes / 60)} hr ago`;
}

function Icon({ name, size = 21, color = COLORS.ink }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function Avatar({ member, size = 48, showDot = false }: { member: Member; size?: number; showDot?: boolean }) {
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: member.color }]}>
      <Text style={[styles.avatarText, { fontSize: size * 0.31 }]}>{member.initials}</Text>
      {showDot && <View style={styles.onlineDot} />}
    </View>
  );
}

function SectionTitle({ eyebrow, title, action, onAction }: { eyebrow?: string; title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionTitleRow}>
      <View>
        {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {action && <Pressable onPress={onAction} hitSlop={8}><Text style={styles.actionText}>{action}</Text></Pressable>}
    </View>
  );
}

function Header({ circleName, onSettings }: { circleName: string; onSettings: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.brandMark}><Icon name="navigate" size={17} color={COLORS.white} /></View>
      <View style={styles.brandCopy}><Text style={styles.brandName}>Free360</Text><Text style={styles.brandSubline}>{circleName.toUpperCase()}</Text></View>
      <Pressable style={styles.headerAvatarButton} onPress={onSettings} hitSlop={8}><Avatar member={selfMember} size={38} /></Pressable>
    </View>
  );
}

function MapScreen({ currentCoordinate, locationEnabled, circleName, circleMembers, circleConnected, onRequestLocation, onCheckIn, onRecenter, onOpenMember }: { currentCoordinate: { latitude: number; longitude: number }; locationEnabled: boolean; circleName: string; circleMembers: Member[]; circleConnected: boolean; onRequestLocation: () => void; onCheckIn: () => void; onRecenter: () => void; onOpenMember: (member: Member) => void }) {
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    mapRef.current?.animateToRegion({ ...INITIAL_REGION, ...currentCoordinate }, 500);
  }, [currentCoordinate]);

  const recenter = () => {
    mapRef.current?.animateToRegion({ ...INITIAL_REGION, ...currentCoordinate }, 450);
    onRecenter();
  };

  return (
    <View style={styles.mapScreen}>
      <MapView ref={mapRef} style={StyleSheet.absoluteFill} initialRegion={INITIAL_REGION} mapType={Platform.OS === 'android' ? 'none' : 'standard'} showsCompass={false} showsBuildings={false} showsPointsOfInterests={false} showsUserLocation={locationEnabled} toolbarEnabled={false}>
        <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />
        {circleMembers.filter((member) => !member.isPaused).map((member) => {
          const coordinate = member.isYou ? currentCoordinate : member.coordinate;
          return <Marker key={member.id} coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} onPress={() => onOpenMember(member)} tracksViewChanges={false}><View style={[styles.mapMarker, member.isStale && styles.mapMarkerStale, { borderColor: member.color }]}><Text style={[styles.mapMarkerText, { color: member.color }]}>{member.initials}</Text></View></Marker>;
        })}
      </MapView>

      <View style={styles.mapTopOverlay}>
        <View style={styles.safePill}><View style={styles.safeIcon}><Icon name={circleConnected ? 'cloud-done-outline' : 'cloud-offline-outline'} size={15} color={circleConnected ? COLORS.mint : COLORS.yellow} /></View><View><Text style={styles.safePillLabel}>{!circleName ? 'NO CIRCLE YET' : circleConnected ? 'CIRCLE CONNECTED' : 'CIRCLE OFFLINE'}</Text><Text style={styles.safePillValue}>{!circleName ? 'Create or join a circle to begin' : circleMembers.some((member) => member.isStale) ? 'Some locations are stale' : circleConnected ? 'Locations are not safety alerts' : 'Updates may be delayed'}</Text></View></View>
        {!locationEnabled && <Pressable style={styles.locationPrompt} onPress={onRequestLocation}><Icon name="location-outline" size={17} color={COLORS.coral} /><Text style={styles.locationPromptText}>Turn on location sharing</Text><Icon name="arrow-forward" size={16} color={COLORS.coral} /></Pressable>}
      </View>

      <View style={styles.mapControls}><Pressable style={styles.mapControlButton} onPress={recenter} hitSlop={6}><Icon name="locate" size={21} color={COLORS.ink} /></Pressable><Pressable style={styles.mapControlButton} onPress={() => Alert.alert('Map style', 'OpenStreetMap tiles are active for this preview.')} hitSlop={6}><Icon name="layers-outline" size={21} color={COLORS.ink} /></Pressable></View>
      <View style={styles.mapAttribution}><Text style={styles.attributionText}>© OpenStreetMap contributors</Text></View>

      <View style={styles.mapBottomCard}>
        <View style={styles.cardHandle} />
        <View style={styles.mapBottomHeader}><View><Text style={styles.mapBottomEyebrow}>{(circleName || 'PRIVATE CIRCLE').toUpperCase()}</Text><Text style={styles.mapBottomTitle}>{circleMembers.length} known member{circleMembers.length === 1 ? '' : 's'}</Text></View><View style={styles.connectedAvatars}>{circleMembers.slice(1, 4).map((member, index) => <Avatar key={member.id} member={member} size={34 - index * 2} />)}{circleMembers.length > 4 && <View style={styles.moreAvatar}><Text style={styles.moreAvatarText}>+{circleMembers.length - 4}</Text></View>}</View></View>
        <View style={styles.mapBottomDivider} />
        <View style={styles.quickActions}><Pressable style={styles.checkInButton} onPress={onCheckIn}><Icon name="checkmark-circle" size={19} color={COLORS.white} /><Text style={styles.checkInButtonText}>Check in</Text></Pressable><Pressable style={styles.shareButton} onPress={onRequestLocation}><Icon name="location-outline" size={19} color={COLORS.ink} /><Text style={styles.shareButtonText}>Enable location</Text></Pressable></View>
      </View>
    </View>
  );
}

function CircleScreen({ circleMembers, circleName, onInvite, onOpenMember }: { circleMembers: Member[]; circleName: string; onInvite: () => void; onOpenMember: (member: Member) => void }) {
  return (
    <ScrollView style={styles.contentScreen} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      <SectionTitle eyebrow="YOUR CIRCLE" title={circleName} action="Manage" onAction={() => Alert.alert('Circle settings', 'Private-circle management is coming next.')} />
      <View style={styles.circleHero}><View style={styles.circleHeroOrb}><Icon name="people" size={28} color={COLORS.white} /></View><View style={styles.circleHeroCopy}><Text style={styles.circleHeroTitle}>Your private circle</Text><Text style={styles.circleHeroBody}>Known devices appear after they share a location. Invite someone you trust to join.</Text></View><Pressable style={styles.circleInviteSmall} onPress={onInvite}><Icon name="add" size={19} color={COLORS.coral} /></Pressable></View>
      <SectionTitle eyebrow="MEMBERS" title={`${circleMembers.length} ${circleMembers.length === 1 ? 'person' : 'people'}`} />
      <View style={styles.memberList}>{circleMembers.map((member, index) => <Pressable key={member.id} style={[styles.memberRow, index === circleMembers.length - 1 && styles.memberRowLast]} onPress={() => onOpenMember(member)}><Avatar member={member} size={48} /><View style={styles.memberCopy}><View style={styles.memberNameRow}><Text style={styles.memberName}>{member.name}</Text>{member.isYou && <Text style={styles.youLabel}>YOU</Text>}</View><Text style={styles.memberStatus}>{member.status} · {member.lastSeen}</Text></View><View style={styles.memberTrailing}><Icon name="chevron-forward" size={18} color={COLORS.subtle} /></View></Pressable>)}</View>
      <Pressable style={styles.inviteButton} onPress={onInvite}><Icon name="person-add-outline" size={19} color={COLORS.coral} /><Text style={styles.inviteButtonText}>Invite a circle member</Text><Icon name="arrow-forward" size={17} color={COLORS.coral} /></Pressable>
      <Text style={styles.emptyNote}>Saved places and arrival alerts are not available yet.</Text>
    </ScrollView>
  );
}

function ActivityScreen({ onCheckIn, checkIns, circle }: { onCheckIn: () => void; checkIns: { deviceId: string; payload: CheckIn }[]; circle: CircleConfig | null }) {
  return (
    <ScrollView style={styles.contentScreen} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      <SectionTitle eyebrow="ENCRYPTED UPDATES" title="Circle activity" />
      <Text style={styles.emptyNote}>Encrypted check-ins appear here. This is not an emergency monitoring service.</Text>
      <Text style={styles.timelineLabel}>RECENT CHECK-INS</Text>
      {checkIns.length ? <View style={styles.timeline}>{checkIns.map(({ deviceId, payload }, index) => <ActivityItem key={payload.id} icon="checkmark-circle" tone="mint" time={new Date(payload.recordedAt).toLocaleString()} title={deviceId === circle?.deviceId ? 'You checked in' : `Member ${deviceId.slice(0, 6)} checked in`} body={payload.message || 'No note'} isLast={index === checkIns.length - 1} />)}</View> : <Text style={styles.emptyNote}>No check-ins yet.</Text>}
      <Pressable style={styles.fullWidthAction} onPress={onCheckIn}><Icon name="checkmark-circle-outline" size={19} color={COLORS.coral} /><Text style={styles.fullWidthActionText}>Send a check-in to your circle</Text><Icon name="arrow-forward" size={17} color={COLORS.coral} /></Pressable>
    </ScrollView>
  );
}

function ActivityItem({ icon, tone, time, title, body, isLast = false }: { icon: IconName; tone: 'blue' | 'coral' | 'mint' | 'yellow'; time: string; title: string; body: string; isLast?: boolean }) {
  const palette = { blue: COLORS.blue, coral: COLORS.coral, mint: COLORS.mint, yellow: COLORS.yellow }[tone];
  const iconName = `${icon}-outline` as IconName;
  return <View style={styles.timelineItem}><View style={styles.timelineRail}><View style={[styles.timelineIcon, { backgroundColor: tone === 'blue' ? COLORS.blueSoft : tone === 'coral' ? COLORS.coralSoft : tone === 'mint' ? COLORS.mintSoft : COLORS.yellowSoft }]}><Icon name={iconName} size={17} color={palette} /></View>{!isLast && <View style={styles.timelineLine} />}</View><View style={styles.timelineCopy}><Text style={styles.timelineTime}>{time}</Text><Text style={styles.timelineTitle}>{title}</Text><Text style={styles.timelineBody}>{body}</Text></View></View>;
}

function YouScreen({ locationEnabled, locationReady, backgroundReady, circleConnected, onToggleLocation, onBackgroundLocation, circle, onCircleSetup, onInvite, onJoin }: { locationEnabled: boolean; locationReady: boolean; backgroundReady: boolean; circleConnected: boolean; onToggleLocation: () => void; onBackgroundLocation: () => void; circle: CircleConfig | null; onCircleSetup: () => void; onInvite: () => void; onJoin: () => void }) {
  return (
    <ScrollView style={styles.contentScreen} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      <SectionTitle eyebrow="YOUR DEVICE" title="You" />
      <View style={styles.profileCard}><Avatar member={selfMember} size={68} /><View style={styles.profileCopy}><Text style={styles.profileName}>This device</Text><Text style={styles.profileEmail}>No email or password required</Text><View style={styles.profileStatus}><View style={styles.profileStatusDot} /><Text style={styles.profileStatusText}>{circle ? locationEnabled ? 'Sharing with your circle' : 'Location sharing paused' : 'No circle configured'}</Text></View></View></View>
      <SectionTitle eyebrow="LOCATION" title="Sharing controls" />
      <View style={styles.settingsCard}>
        <View style={styles.settingRow}><View style={[styles.settingIcon, { backgroundColor: COLORS.coralSoft }]}><Icon name="location" size={19} color={COLORS.coral} /></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>Location sharing</Text><Text style={styles.settingDescription}>{!locationReady ? 'Checking device sharing state…' : locationEnabled ? 'Location updates enabled on this device' : 'Location sharing is paused'}</Text></View><Switch value={locationEnabled} disabled={!locationReady} onValueChange={onToggleLocation} trackColor={{ false: '#D6DCE5', true: '#FFB8B1' }} thumbColor={locationEnabled ? COLORS.coral : '#FFFFFF'} /></View>
        <View style={styles.settingsDivider} />
        <Pressable style={styles.settingRow} onPress={onBackgroundLocation}><View style={[styles.settingIcon, { backgroundColor: COLORS.blueSoft }]}><Icon name="navigate" size={19} color={COLORS.blue} /></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>Background updates</Text><Text style={styles.settingDescription}>{backgroundReady ? 'Registered on this device' : 'Not active · development build required'}</Text></View><View style={[styles.statusCheck, { backgroundColor: backgroundReady ? COLORS.mintSoft : COLORS.yellowSoft }]}><Icon name={backgroundReady ? 'checkmark' : 'information'} size={15} color={backgroundReady ? COLORS.mint : '#C88313'} /></View></Pressable>
      </View>
      <View style={styles.privacyNote}><Icon name="lock-closed-outline" size={17} color={COLORS.muted} /><Text style={styles.privacyText}>Your location is shared only with members of your circle. You can pause sharing any time.</Text></View>
      <SectionTitle eyebrow="YOUR GROUP" title="Private circle" action={circle?.isOwner ? 'Invite' : undefined} onAction={onInvite} />
      <View style={styles.settingsCard}>
        <Pressable style={styles.settingRow} onPress={onCircleSetup}>
          <View style={[styles.settingIcon, { backgroundColor: circle ? COLORS.mintSoft : COLORS.coralSoft }]}><Icon name={circle ? 'shield-checkmark-outline' : 'server-outline'} size={19} color={circle ? COLORS.mint : COLORS.coral} /></View>
          <View style={styles.settingCopy}><Text style={styles.settingTitle}>{circle ? circle.circleName : 'Create a private circle'}</Text><Text style={styles.settingDescription}>{circle ? `${circle.isOwner ? 'Circle owner' : 'Circle member'} · ${circleConnected ? 'connected' : 'offline'}` : 'Connect through your group’s Supabase project'}</Text></View><Icon name="chevron-forward" size={18} color={COLORS.subtle} />
        </Pressable>
        {!circle && <><View style={styles.settingsDivider} /><Pressable style={styles.settingRow} onPress={onJoin}><View style={[styles.settingIcon, { backgroundColor: COLORS.blueSoft }]}><Icon name="qr-code-outline" size={19} color={COLORS.blue} /></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>Join with invitation QR</Text><Text style={styles.settingDescription}>No email sign-up needed</Text></View><Icon name="chevron-forward" size={18} color={COLORS.subtle} /></Pressable></>}
      </View>
      <Text style={styles.emptyNote}>Notifications, saved places, and automatic safety alerts are not available in this MVP.</Text>
      <Text style={styles.versionText}>Free360 preview · v0.1.0</Text>
    </ScrollView>
  );
}

function BottomTabs({ activeTab, onTabChange }: { activeTab: Tab; onTabChange: (tab: Tab) => void }) {
  const tabs: { key: Tab; label: string; icon: IconName; activeIcon: IconName }[] = [{ key: 'map', label: 'Map', icon: 'map-outline', activeIcon: 'map' }, { key: 'circle', label: 'Circle', icon: 'people-outline', activeIcon: 'people' }, { key: 'activity', label: 'Activity', icon: 'pulse-outline', activeIcon: 'pulse' }, { key: 'you', label: 'You', icon: 'person-outline', activeIcon: 'person' }];
  return <View style={styles.bottomTabs}>{tabs.map((tab) => { const isActive = tab.key === activeTab; return <Pressable key={tab.key} style={styles.tabButton} onPress={() => onTabChange(tab.key)}><View style={[styles.tabIconWrap, isActive && styles.tabIconWrapActive]}><Icon name={isActive ? tab.activeIcon : tab.icon} size={21} color={isActive ? COLORS.coral : COLORS.muted} /></View><Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{tab.label}</Text></Pressable>; })}</View>;
}

function CheckInModal({ visible, onClose, onConfirm }: { visible: boolean; onClose: () => void; onConfirm: (message: string) => void }) {
  const [message, setMessage] = useState('I’m safe and on my way.');
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}><Pressable style={styles.modalDismissArea} onPress={onClose} /><View style={styles.checkInSheet}><View style={styles.sheetHandle} /><View style={styles.sheetIcon}><Icon name="checkmark-circle" size={32} color={COLORS.mint} /></View><Text style={styles.sheetTitle}>Check in with your circle</Text><Text style={styles.sheetBody}>Let everyone know you’re okay. This will appear in your circle activity.</Text><TextInput value={message} onChangeText={setMessage} style={styles.messageInput} placeholder="Add a note" placeholderTextColor={COLORS.subtle} multiline /><Pressable style={styles.confirmCheckIn} onPress={() => onConfirm(message)}><Text style={styles.confirmCheckInText}>Send check-in</Text><Icon name="arrow-forward" size={18} color={COLORS.white} /></Pressable><Pressable style={styles.cancelButton} onPress={onClose}><Text style={styles.cancelButtonText}>Not now</Text></Pressable></View></KeyboardAvoidingView></Modal>;
}

function MemberModal({ member, onClose }: { member: Member | null; onClose: () => void }) {
  if (!member) return null;
  return <Modal visible={Boolean(member)} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalBackdrop}><Pressable style={styles.modalDismissArea} onPress={onClose} /><View style={styles.memberSheet}><View style={styles.sheetHandle} /><View style={styles.memberSheetHeader}><Avatar member={member} size={60} showDot={!member.isYou} /><View style={styles.memberSheetCopy}><Text style={styles.sheetTitle}>{member.name}</Text><Text style={styles.memberSheetRole}>{member.role} · {member.status}</Text></View><Pressable onPress={onClose} hitSlop={8}><Icon name="close" size={22} color={COLORS.muted} /></Pressable></View><View style={styles.memberDetailGrid}><DetailStat icon="location" label="Location" value={member.status} /><DetailStat icon="time-outline" label="Last update" value={member.lastSeen.replace('Updated ', '')} /><DetailStat icon="battery-half" label="Battery" value={`${member.battery}%`} /></View><Pressable style={styles.outlineSheetButton} onPress={onClose}><Icon name="navigate-outline" size={18} color={COLORS.ink} /><Text style={styles.outlineSheetButtonText}>View on map</Text></Pressable></View></View></Modal>;
}

function DetailStat({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return <View style={styles.detailStat}><Icon name={icon} size={17} color={COLORS.coral} /><Text style={styles.detailStatLabel}>{label}</Text><Text style={styles.detailStatValue}>{value}</Text></View>;
}

export default function App() {
  const router = useRouter();
  const pathname = usePathname();
  const activeTab: Tab = pathname === '/circle' || pathname === '/activity' || pathname === '/you' ? pathname.slice(1) as Tab : 'map';
  const [locationEnabled, setLocationEnabled] = useState(false);
  const [locationReady, setLocationReady] = useState(Platform.OS === 'web');
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [currentCoordinate, setCurrentCoordinate] = useState<{ latitude: number; longitude: number }>({ latitude: INITIAL_REGION.latitude, longitude: INITIAL_REGION.longitude });
  const [hasCurrentLocation, setHasCurrentLocation] = useState(false);
  const [circle, setCircle] = useState<CircleConfig | null>(null);
  const [remoteSnapshots, setRemoteSnapshots] = useState<Record<string, CircleSnapshot>>({});
  const [checkIns, setCheckIns] = useState<{ deviceId: string; payload: CheckIn }[]>([]);
  const [circleConnected, setCircleConnected] = useState(false);
  const [now, setNow] = useState(0);
  const [checkInVisible, setCheckInVisible] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [toast, setToast] = useState('');
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const circleRef = useRef<CircleConfig | null>(null);

  useEffect(() => {
    const firstTick = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => { clearTimeout(firstTick); clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => { watcher.current?.remove(); }, []);

  useEffect(() => {
    let cancelled = false;
    if (Platform.OS === 'web') return;
    void Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).then(async (registered) => {
      if (cancelled) return;
      setBackgroundReady(registered);
      setLocationEnabled(registered);
      if (registered) {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.granted && !watcher.current && !cancelled) {
          watcher.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 15000 }, (position) => {
            setCurrentCoordinate({ latitude: position.coords.latitude, longitude: position.coords.longitude });
            setHasCurrentLocation(true);
            const currentCircle = circleRef.current;
            if (currentCircle) void publishLocation(currentCircle, { latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy }, new Date(position.timestamp).toISOString()).catch((error) => console.warn('[Free360] Foreground location queued:', error));
          });
        }
      }
    }).catch((error) => console.warn('[Free360] Could not inspect background task:', error)).finally(() => { if (!cancelled) setLocationReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    void loadCircle().then((savedCircle) => {
      if (circleRef.current?.circleId !== savedCircle?.circleId) {
        setRemoteSnapshots({});
        setCheckIns([]);
        setCircleConnected(false);
        setCircle(savedCircle);
      }
      circleRef.current = savedCircle;
    }).catch((error) => console.warn('[Free360] Could not load circle:', error));
  }, [pathname]);

  useEffect(() => {
    if (!circle) return;
    const subscription = subscribeToCircle(circle, (update) => {
      if (update.kind === 'snapshot' && update.deviceId !== circle.deviceId) setRemoteSnapshots((current) => ({ ...current, [update.deviceId]: update.payload }));
      if (update.kind === 'checkin') setCheckIns((current) => current.some((item) => item.payload.id === update.payload.id) ? current : [{ deviceId: update.deviceId, payload: update.payload }, ...current].sort((a, b) => Date.parse(b.payload.recordedAt) - Date.parse(a.payload.recordedAt)).slice(0, 100));
    }, setCircleConnected);
    return () => subscription.close();
  }, [circle]);

  const mapMembers = useMemo(() => {
    if (!circle) return [];
    const localMember = { ...selfMember, coordinate: currentCoordinate, role: circle.isOwner ? 'Circle owner' : 'Circle member', status: locationEnabled ? 'Location enabled' : 'Sharing paused', lastSeen: locationEnabled && hasCurrentLocation ? 'On this device' : 'No live location', isPaused: !locationEnabled || !hasCurrentLocation };
    const remoteMembers = Object.entries(remoteSnapshots).map(([deviceId, snapshot], index) => ({
      id: deviceId,
      name: `Member ${deviceId.slice(0, 6)}`,
      initials: `M${index + 1}`,
      role: 'Circle member',
      status: snapshot.type === 'paused' ? 'Sharing paused' : now - Date.parse(snapshot.recordedAt) > STALE_AFTER_MS ? 'Location stale' : 'Location shared',
      lastSeen: ageLabel(snapshot.recordedAt, now),
      coordinate: snapshot.type === 'location' ? { latitude: snapshot.latitude, longitude: snapshot.longitude } : INITIAL_REGION,
      color: ['#6B78E5', '#F19A5A', '#49A995', '#4386F4'][index % 4],
      battery: 0,
      isPaused: snapshot.type === 'paused',
      isStale: snapshot.type === 'location' && now - Date.parse(snapshot.recordedAt) > STALE_AFTER_MS,
    }));
    return [localMember, ...remoteMembers];
  }, [circle, currentCoordinate, hasCurrentLocation, locationEnabled, remoteSnapshots, now]);

  const shareLocation = (position: Location.LocationObject) => {
    const currentCircle = circleRef.current;
    if (!currentCircle) return;
    void publishLocation(currentCircle, {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    }, new Date(position.timestamp).toISOString()).catch((error) => console.warn('[Free360] Foreground location queued:', error));
  };

  const requestLocation = async () => {
    if (!circleRef.current) { router.push('/create-circle'); return; }
    if (Platform.OS === 'web') {
      setToast('Location preview is available on a physical device.');
      return;
    }
    try {
      const foreground = await Location.requestForegroundPermissionsAsync();
      if (foreground.status !== 'granted') {
        setToast('Location permission is needed to share your location.');
        return;
      }

      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCurrentCoordinate({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      setHasCurrentLocation(true);
      shareLocation(current);
      if (!watcher.current) {
        watcher.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 15000 }, (position) => {
          setCurrentCoordinate({ latitude: position.coords.latitude, longitude: position.coords.longitude });
          setHasCurrentLocation(true);
          shareLocation(position);
        });
      }

      let backgroundStarted = false;
      try {
        const background = await Location.requestBackgroundPermissionsAsync();
        if (background.status === 'granted') {
          if (!await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, { accuracy: Location.Accuracy.Balanced, distanceInterval: 50, timeInterval: 30000, pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true, foregroundService: { notificationTitle: 'Free360 location sharing', notificationBody: 'Your circle can see your location.', notificationColor: COLORS.coral } });
          backgroundStarted = true;
          setBackgroundReady(true);
        } else {
          setBackgroundReady(false);
        }
      } catch {
        setBackgroundReady(false);
      }
      setLocationEnabled(true);
      setToast(backgroundStarted ? 'Location sharing is on, including background updates.' : 'Sharing while open. Background sharing needs permission and a development build.');
    } catch {
      setToast('We couldn’t access your location. Check device permissions.');
    }
  };

  const stopLocation = async () => {
    try {
      if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch (error) {
      if (backgroundReady) {
        console.warn('[Free360] Could not stop background sharing:', error);
        setToast('Could not stop background sharing. Check device settings and try again.');
        return;
      }
    }
    watcher.current?.remove();
    watcher.current = null;
    setLocationEnabled(false);
    setBackgroundReady(false);
    if (circleRef.current) {
      try {
        await publishPaused(circleRef.current);
        setToast('Location sharing is paused.');
      } catch {
        setToast('Sharing stopped on this device. Paused status will sync when the connection returns.');
      }
    }
  };

  const toggleLocation = () => { if (locationEnabled) void stopLocation(); else void requestLocation(); };
  const invite = () => {
    if (!circle) {
      router.push('/create-circle');
      return;
    }
    if (!circle.isOwner) {
      setToast('Only the phone that created this circle can make invitations.');
      return;
    }
    router.push('/invite');
  };
  const checkIn = async (message: string) => {
    if (!circle) { setCheckInVisible(false); router.push('/create-circle'); return; }
    try {
      const payload = await publishCheckIn(circle, message);
      setCheckIns((current) => [{ deviceId: circle.deviceId, payload }, ...current].slice(0, 100));
      setCheckInVisible(false);
      setToast('Check-in sent to your circle.');
    } catch {
      setToast('Check-in not sent. Reconnect to your group project and try again.');
    }
  };

  const content = (() => {
    if (activeTab === 'map') return <MapScreen currentCoordinate={currentCoordinate} locationEnabled={locationEnabled} circleName={circle?.circleName ?? ''} circleMembers={mapMembers} circleConnected={circleConnected} onRequestLocation={requestLocation} onCheckIn={() => setCheckInVisible(true)} onRecenter={() => setToast('Map centered on your location.')} onOpenMember={setSelectedMember} />;
    if (activeTab === 'circle') return <CircleScreen circleMembers={mapMembers} circleName={circle?.circleName ?? 'No circle yet'} onInvite={invite} onOpenMember={setSelectedMember} />;
    if (activeTab === 'activity') return <ActivityScreen circle={circle} checkIns={checkIns} onCheckIn={() => setCheckInVisible(true)} />;
    return <YouScreen locationEnabled={locationEnabled} locationReady={locationReady} backgroundReady={backgroundReady} circleConnected={circleConnected} onToggleLocation={toggleLocation} onBackgroundLocation={() => setToast(backgroundReady ? 'Background location is registered on this device.' : 'Background location needs permission and a development build.')} circle={circle} onCircleSetup={() => circle ? setToast(circleConnected ? 'Your group project is connected.' : 'Your group project is offline.') : router.push('/create-circle')} onInvite={invite} onJoin={() => router.push('/join')} />;
  })();

  return <SafeAreaView style={styles.appRoot}><StatusBar style="dark" /><Header circleName={circle?.circleName ?? 'No circle'} onSettings={() => router.replace('/you')} /><View style={styles.mainContent}>{content}</View><BottomTabs activeTab={activeTab} onTabChange={(tab) => router.replace(`/${tab}`)} />{Boolean(toast) && <View style={styles.toast}><Icon name="information-circle" size={18} color={COLORS.white} /><Text style={styles.toastText}>{toast}</Text></View>}<CheckInModal visible={checkInVisible} onClose={() => setCheckInVisible(false)} onConfirm={checkIn} /><MemberModal member={selectedMember} onClose={() => setSelectedMember(null)} /></SafeAreaView>;
}

const styles = StyleSheet.create({
  appRoot: { flex: 1, backgroundColor: COLORS.canvas },
  emptyNote: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginBottom: 18 },
  mainContent: { flex: 1 },
  header: { height: 76, backgroundColor: COLORS.white, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  brandMark: { width: 36, height: 36, borderRadius: 12, backgroundColor: COLORS.coral, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '-8deg' }] },
  brandCopy: { marginLeft: 10, flex: 1 },
  brandName: { fontSize: 19, fontWeight: '800', color: COLORS.ink, letterSpacing: -0.4 },
  brandSubline: { color: COLORS.subtle, fontWeight: '700', fontSize: 8.5, letterSpacing: 1.5, marginTop: 3 },
  headerIconButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: COLORS.canvas, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  notificationDot: { position: 'absolute', top: 8, right: 8, width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.coral, borderWidth: 1, borderColor: COLORS.canvas },
  headerAvatarButton: { borderRadius: 21, padding: 1, borderWidth: 1, borderColor: COLORS.border },
  contentScreen: { flex: 1, backgroundColor: COLORS.canvas },
  contentContainer: { padding: 20, paddingBottom: 34 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 14, marginTop: 8 },
  eyebrow: { fontSize: 10, color: COLORS.subtle, fontWeight: '800', letterSpacing: 1.4, marginBottom: 5 },
  sectionTitle: { color: COLORS.ink, fontSize: 25, lineHeight: 29, fontWeight: '800', letterSpacing: -0.6 },
  actionText: { color: COLORS.coral, fontWeight: '700', fontSize: 13, marginBottom: 3 },
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.white, position: 'relative' },
  avatarText: { color: COLORS.white, fontWeight: '800', letterSpacing: -0.5 },
  onlineDot: { position: 'absolute', right: -1, bottom: 0, width: 12, height: 12, backgroundColor: COLORS.mint, borderRadius: 6, borderWidth: 2, borderColor: COLORS.white },
  mapScreen: { flex: 1, overflow: 'hidden' },
  mapTopOverlay: { position: 'absolute', top: 16, left: 16, right: 16, gap: 10 },
  safePill: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.96)', borderRadius: 17, paddingVertical: 9, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', shadowColor: '#16233B', shadowOpacity: 0.13, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  safeIcon: { width: 28, height: 28, borderRadius: 9, backgroundColor: COLORS.mintSoft, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  safePillLabel: { color: COLORS.ink, fontWeight: '800', fontSize: 10, letterSpacing: 0.9 },
  safePillValue: { color: COLORS.muted, fontSize: 10, marginTop: 2 },
  locationPrompt: { backgroundColor: COLORS.white, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', shadowColor: '#16233B', shadowOpacity: 0.11, shadowRadius: 9, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  locationPromptText: { flex: 1, marginLeft: 8, color: COLORS.ink, fontWeight: '700', fontSize: 13 },
  mapControls: { position: 'absolute', right: 16, top: 18, gap: 9 },
  mapControlButton: { width: 42, height: 42, borderRadius: 13, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', shadowColor: '#16233B', shadowOpacity: 0.13, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  mapMarker: { width: 45, height: 45, borderRadius: 23, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center', borderWidth: 4, shadowColor: '#16233B', shadowOpacity: 0.2, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  mapMarkerStale: { opacity: 0.45 },
  mapMarkerText: { fontSize: 12, fontWeight: '900' },
  mapAttribution: { position: 'absolute', bottom: 173, left: 8, backgroundColor: 'rgba(255,255,255,0.78)', paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3 },
  attributionText: { color: '#43506A', fontSize: 8 },
  mapBottomCard: { position: 'absolute', left: 12, right: 12, bottom: 12, backgroundColor: COLORS.white, borderRadius: 24, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 15, shadowColor: '#16233B', shadowOpacity: 0.18, shadowRadius: 15, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
  cardHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#DDE2E9', alignSelf: 'center', marginBottom: 13 },
  mapBottomHeader: { flexDirection: 'row', alignItems: 'center' },
  mapBottomEyebrow: { color: COLORS.coral, fontSize: 9, fontWeight: '800', letterSpacing: 1.3, marginBottom: 4 },
  mapBottomTitle: { color: COLORS.ink, fontSize: 17, fontWeight: '800' },
  connectedAvatars: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  moreAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.canvas, borderWidth: 2, borderColor: COLORS.white, alignItems: 'center', justifyContent: 'center', marginLeft: -5 },
  moreAvatarText: { fontSize: 9, fontWeight: '800', color: COLORS.muted },
  mapBottomDivider: { height: 1, backgroundColor: COLORS.border, marginVertical: 13 },
  quickActions: { flexDirection: 'row', gap: 9 },
  checkInButton: { flex: 1, height: 45, backgroundColor: COLORS.coral, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  checkInButtonText: { color: COLORS.white, fontWeight: '800', fontSize: 13 },
  shareButton: { flex: 1, height: 45, backgroundColor: COLORS.canvas, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  shareButtonText: { color: COLORS.ink, fontWeight: '800', fontSize: 13 },
  circleHero: { backgroundColor: COLORS.ink, borderRadius: 21, padding: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 26 },
  circleHeroOrb: { width: 52, height: 52, borderRadius: 18, backgroundColor: COLORS.coral, alignItems: 'center', justifyContent: 'center' },
  circleHeroCopy: { flex: 1, paddingLeft: 13, paddingRight: 8 },
  circleHeroTitle: { color: COLORS.white, fontWeight: '800', fontSize: 16, marginBottom: 4 },
  circleHeroBody: { color: '#C8D0DE', fontSize: 11.5, lineHeight: 17 },
  circleInviteSmall: { width: 35, height: 35, borderRadius: 12, backgroundColor: COLORS.white, alignItems: 'center', justifyContent: 'center' },
  memberList: { backgroundColor: COLORS.white, borderRadius: 20, paddingHorizontal: 16, marginBottom: 12 },
  memberRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: COLORS.border },
  memberRowLast: { borderBottomWidth: 0 },
  memberCopy: { flex: 1, marginLeft: 12 },
  memberNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  memberName: { color: COLORS.ink, fontWeight: '800', fontSize: 14 },
  youLabel: { color: COLORS.coral, fontSize: 8, letterSpacing: 0.7, fontWeight: '900' },
  memberStatus: { color: COLORS.muted, fontSize: 11.5, marginTop: 5 },
  memberTrailing: { alignItems: 'flex-end', gap: 7 },
  batteryRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  batteryText: { color: COLORS.muted, fontSize: 10 },
  inviteButton: { height: 54, borderRadius: 16, backgroundColor: COLORS.coralSoft, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 19, gap: 9 },
  inviteButtonText: { flex: 1, color: COLORS.coral, fontWeight: '800', fontSize: 13 },
  placeCard: { backgroundColor: COLORS.white, borderRadius: 17, padding: 13, flexDirection: 'row', alignItems: 'center', marginBottom: 9 },
  placeIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  placeCopy: { flex: 1, marginLeft: 11 },
  placeName: { color: COLORS.ink, fontWeight: '800', fontSize: 13 },
  placeAddress: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  activitySummary: { backgroundColor: COLORS.white, borderRadius: 19, padding: 15, flexDirection: 'row', alignItems: 'center', marginBottom: 27 },
  activitySummaryIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: COLORS.mintSoft, alignItems: 'center', justifyContent: 'center' },
  activitySummaryCopy: { flex: 1, marginLeft: 11 },
  activitySummaryTitle: { color: COLORS.ink, fontWeight: '800', fontSize: 13 },
  activitySummaryText: { color: COLORS.muted, fontSize: 10.5, marginTop: 4 },
  pill: { flexDirection: 'row', alignItems: 'center', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 6, gap: 4 },
  pillDot: { width: 5, height: 5, borderRadius: 3 },
  pillText: { fontSize: 9.5, fontWeight: '800' },
  timelineLabel: { color: COLORS.subtle, fontSize: 10, fontWeight: '800', letterSpacing: 1.3, marginBottom: 13 },
  timeline: { backgroundColor: COLORS.white, borderRadius: 20, padding: 17, marginBottom: 13 },
  timelineItem: { flexDirection: 'row', minHeight: 76 },
  timelineRail: { width: 36, alignItems: 'center' },
  timelineIcon: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  timelineLine: { position: 'absolute', top: 34, bottom: -2, width: 1, backgroundColor: COLORS.border },
  timelineCopy: { flex: 1, marginLeft: 10 },
  timelineTime: { color: COLORS.subtle, fontSize: 10, fontWeight: '700' },
  timelineTitle: { color: COLORS.ink, fontWeight: '800', fontSize: 13, marginTop: 3 },
  timelineBody: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  fullWidthAction: { height: 53, backgroundColor: COLORS.white, borderRadius: 16, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 9 },
  fullWidthActionText: { flex: 1, color: COLORS.ink, fontWeight: '800', fontSize: 12.5 },
  profileCard: { backgroundColor: COLORS.white, borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  profileCopy: { flex: 1, marginLeft: 13 },
  profileName: { color: COLORS.ink, fontWeight: '800', fontSize: 17 },
  profileEmail: { color: COLORS.muted, fontSize: 11, marginTop: 4 },
  profileStatus: { flexDirection: 'row', alignItems: 'center', marginTop: 9, gap: 5 },
  profileStatusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.mint },
  profileStatusText: { color: COLORS.mint, fontSize: 10, fontWeight: '700' },
  settingsCard: { backgroundColor: COLORS.white, borderRadius: 20, paddingHorizontal: 15, marginBottom: 20 },
  settingRow: { minHeight: 72, flexDirection: 'row', alignItems: 'center' },
  settingIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  settingCopy: { flex: 1, marginLeft: 11, paddingRight: 10 },
  settingTitle: { color: COLORS.ink, fontWeight: '800', fontSize: 13 },
  settingDescription: { color: COLORS.muted, fontSize: 10.5, marginTop: 4, lineHeight: 15 },
  settingsDivider: { height: 1, backgroundColor: COLORS.border, marginLeft: 50 },
  statusCheck: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  privacyNote: { flexDirection: 'row', backgroundColor: '#EDF1F6', borderRadius: 15, padding: 13, marginBottom: 16, gap: 8 },
  privacyText: { flex: 1, color: COLORS.muted, fontSize: 10.5, lineHeight: 15 },
  versionText: { color: COLORS.subtle, fontSize: 10, textAlign: 'center', marginTop: 1 },
  bottomTabs: { height: 76, backgroundColor: COLORS.white, borderTopWidth: 1, borderTopColor: COLORS.border, flexDirection: 'row', paddingHorizontal: 8, paddingTop: 8 },
  tabButton: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', gap: 4 },
  tabIconWrap: { width: 45, height: 31, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabIconWrapActive: { backgroundColor: COLORS.coralSoft },
  tabLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  tabLabelActive: { color: COLORS.coral },
  toast: { position: 'absolute', bottom: 88, left: 18, right: 18, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 14, backgroundColor: COLORS.ink, flexDirection: 'row', alignItems: 'center', gap: 8, shadowColor: '#16233B', shadowOpacity: 0.18, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 8 },
  toastText: { color: COLORS.white, flex: 1, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(11, 23, 42, 0.35)', justifyContent: 'flex-end' },
  modalDismissArea: { flex: 1 },
  checkInSheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 25 },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: '#DCE2EA', alignSelf: 'center', marginBottom: 20 },
  sheetIcon: { width: 62, height: 62, borderRadius: 22, backgroundColor: COLORS.mintSoft, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { color: COLORS.ink, fontSize: 22, fontWeight: '800', textAlign: 'center', letterSpacing: -0.5 },
  sheetBody: { color: COLORS.muted, fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8, marginHorizontal: 14 },
  messageInput: { minHeight: 66, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, padding: 12, color: COLORS.ink, fontSize: 13, marginTop: 18, textAlignVertical: 'top' },
  confirmCheckIn: { height: 50, backgroundColor: COLORS.coral, borderRadius: 14, marginTop: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  confirmCheckInText: { color: COLORS.white, fontWeight: '800', fontSize: 13 },
  cancelButton: { alignItems: 'center', paddingVertical: 14 },
  cancelButtonText: { color: COLORS.muted, fontWeight: '700', fontSize: 12 },
  memberSheet: { backgroundColor: COLORS.white, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 22, paddingTop: 10, paddingBottom: 28 },
  memberSheetHeader: { flexDirection: 'row', alignItems: 'center' },
  memberSheetCopy: { flex: 1, marginLeft: 13 },
  memberSheetRole: { color: COLORS.muted, fontSize: 12, marginTop: 5 },
  memberDetailGrid: { flexDirection: 'row', gap: 8, marginTop: 23, marginBottom: 18 },
  detailStat: { flex: 1, backgroundColor: COLORS.canvas, borderRadius: 14, minHeight: 74, padding: 10 },
  detailStatLabel: { color: COLORS.muted, fontSize: 9, marginTop: 8 },
  detailStatValue: { color: COLORS.ink, fontWeight: '800', fontSize: 11, marginTop: 3 },
  outlineSheetButton: { height: 48, borderWidth: 1, borderColor: COLORS.border, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  outlineSheetButtonText: { color: COLORS.ink, fontWeight: '800', fontSize: 12 },
});
