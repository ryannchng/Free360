import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
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
import { publishStoredLocation } from './src/lib/background-location';
import { type CircleConfig, loadCircle, publishLocation, subscribeToCircle, type SharedLocation } from './src/lib/circle';

const BACKGROUND_LOCATION_TASK = 'free360-background-location';

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

const members: Member[] = [
  {
    id: 'you',
    name: 'You',
    initials: 'JR',
    role: 'Circle owner',
    status: 'At work',
    lastSeen: 'Live now',
    coordinate: { latitude: 40.7428, longitude: -73.9912 },
    color: COLORS.coral,
    battery: 82,
    isYou: true,
  },
  {
    id: 'alex',
    name: 'Alex Rivera',
    initials: 'AR',
    role: 'Partner',
    status: 'At home',
    lastSeen: 'Updated 2 min ago',
    coordinate: { latitude: 40.7455, longitude: -73.9875 },
    color: '#6B78E5',
    battery: 64,
  },
  {
    id: 'maya',
    name: 'Maya Rivera',
    initials: 'MR',
    role: 'Daughter',
    status: 'At school',
    lastSeen: 'Updated 8 min ago',
    coordinate: { latitude: 40.7385, longitude: -73.9951 },
    color: '#F19A5A',
    battery: 49,
  },
  {
    id: 'sam',
    name: 'Sam Rivera',
    initials: 'SR',
    role: 'Brother',
    status: 'At the gym',
    lastSeen: 'Updated 12 min ago',
    coordinate: { latitude: 40.7478, longitude: -73.9943 },
    color: '#49A995',
    battery: 91,
  },
];

TaskManager.defineTask<{ locations?: Location.LocationObject[] }>(
  BACKGROUND_LOCATION_TASK,
  async ({ data, error }) => {
    if (error) {
      console.warn('[Free360] Background location error:', error.message);
      return;
    }

    const latestLocation = data?.locations?.[0];
    if (latestLocation) {
      try {
        await publishStoredLocation(latestLocation);
      } catch (publishError) {
        // A background task must stay resilient to a temporarily unreachable home relay.
        console.warn('[Free360] Could not publish background location:', publishError);
      }
    }
  },
);

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

function Pill({ label, tone = 'mint' }: { label: string; tone?: 'mint' | 'coral' | 'blue' | 'yellow' }) {
  const palette = {
    mint: { backgroundColor: COLORS.mintSoft, color: COLORS.mint },
    coral: { backgroundColor: COLORS.coralSoft, color: COLORS.coral },
    blue: { backgroundColor: COLORS.blueSoft, color: COLORS.blue },
    yellow: { backgroundColor: COLORS.yellowSoft, color: '#C88313' },
  }[tone];

  return <View style={[styles.pill, { backgroundColor: palette.backgroundColor }]}><View style={[styles.pillDot, { backgroundColor: palette.color }]} /><Text style={[styles.pillText, { color: palette.color }]}>{label}</Text></View>;
}

function Header({ circleName, onSettings }: { circleName: string; onSettings: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.brandMark}><Icon name="navigate" size={17} color={COLORS.white} /></View>
      <View style={styles.brandCopy}><Text style={styles.brandName}>Free360</Text><Text style={styles.brandSubline}>{circleName.toUpperCase()}</Text></View>
      <Pressable style={styles.headerIconButton} onPress={onSettings} hitSlop={8}><Icon name="notifications-outline" size={20} color={COLORS.ink} /><View style={styles.notificationDot} /></Pressable>
      <Pressable style={styles.headerAvatarButton} onPress={onSettings} hitSlop={8}><Avatar member={members[0]} size={38} /></Pressable>
    </View>
  );
}

function MapScreen({ currentCoordinate, locationEnabled, circleName, circleMembers, onRequestLocation, onCheckIn, onRecenter, onOpenMember }: { currentCoordinate: { latitude: number; longitude: number }; locationEnabled: boolean; circleName: string; circleMembers: Member[]; onRequestLocation: () => void; onCheckIn: () => void; onRecenter: () => void; onOpenMember: (member: Member) => void }) {
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
        {circleMembers.map((member) => {
          const coordinate = member.isYou ? currentCoordinate : member.coordinate;
          return <Marker key={member.id} coordinate={coordinate} anchor={{ x: 0.5, y: 0.5 }} onPress={() => onOpenMember(member)} tracksViewChanges={false}><View style={[styles.mapMarker, { borderColor: member.color }]}><Text style={[styles.mapMarkerText, { color: member.color }]}>{member.initials}</Text></View></Marker>;
        })}
      </MapView>

      <View style={styles.mapTopOverlay}>
        <View style={styles.safePill}><View style={styles.safeIcon}><Icon name="shield-checkmark" size={15} color={COLORS.mint} /></View><View><Text style={styles.safePillLabel}>EVERYONE SAFE</Text><Text style={styles.safePillValue}>Updated just now</Text></View><Icon name="chevron-forward" size={16} color={COLORS.muted} /></View>
        {!locationEnabled && <Pressable style={styles.locationPrompt} onPress={onRequestLocation}><Icon name="location-outline" size={17} color={COLORS.coral} /><Text style={styles.locationPromptText}>Turn on location sharing</Text><Icon name="arrow-forward" size={16} color={COLORS.coral} /></Pressable>}
      </View>

      <View style={styles.mapControls}><Pressable style={styles.mapControlButton} onPress={recenter} hitSlop={6}><Icon name="locate" size={21} color={COLORS.ink} /></Pressable><Pressable style={styles.mapControlButton} onPress={() => Alert.alert('Map style', 'OpenStreetMap tiles are active for this preview.')} hitSlop={6}><Icon name="layers-outline" size={21} color={COLORS.ink} /></Pressable></View>
      <View style={styles.mapAttribution}><Text style={styles.attributionText}>© OpenStreetMap contributors</Text></View>

      <View style={styles.mapBottomCard}>
        <View style={styles.cardHandle} />
        <View style={styles.mapBottomHeader}><View><Text style={styles.mapBottomEyebrow}>{circleName.toUpperCase()}</Text><Text style={styles.mapBottomTitle}>{circleMembers.length} member{circleMembers.length === 1 ? '' : 's'} connected</Text></View><View style={styles.connectedAvatars}>{circleMembers.slice(1, 4).map((member, index) => <Avatar key={member.id} member={member} size={34 - index * 2} />)}{circleMembers.length > 4 && <View style={styles.moreAvatar}><Text style={styles.moreAvatarText}>+{circleMembers.length - 4}</Text></View>}</View></View>
        <View style={styles.mapBottomDivider} />
        <View style={styles.quickActions}><Pressable style={styles.checkInButton} onPress={onCheckIn}><Icon name="checkmark-circle" size={19} color={COLORS.white} /><Text style={styles.checkInButtonText}>Check in</Text></Pressable><Pressable style={styles.shareButton} onPress={onRequestLocation}><Icon name="share-social-outline" size={19} color={COLORS.ink} /><Text style={styles.shareButtonText}>Share status</Text></Pressable></View>
      </View>
    </View>
  );
}

function CircleScreen({ circleMembers, circleName, onInvite, onOpenMember }: { circleMembers: Member[]; circleName: string; onInvite: () => void; onOpenMember: (member: Member) => void }) {
  return (
    <ScrollView style={styles.contentScreen} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      <SectionTitle eyebrow="YOUR CIRCLE" title={circleName} action="Manage" onAction={() => Alert.alert('Circle settings', 'Private-circle management is coming next.')} />
      <View style={styles.circleHero}><View style={styles.circleHeroOrb}><Icon name="people" size={28} color={COLORS.white} /></View><View style={styles.circleHeroCopy}><Text style={styles.circleHeroTitle}>Everyone is in sync</Text><Text style={styles.circleHeroBody}>Your circle has {circleMembers.length} member{circleMembers.length === 1 ? '' : 's'}. Invite someone you trust to join.</Text></View><Pressable style={styles.circleInviteSmall} onPress={onInvite}><Icon name="add" size={19} color={COLORS.coral} /></Pressable></View>
      <SectionTitle eyebrow="MEMBERS" title={`${circleMembers.length} ${circleMembers.length === 1 ? 'person' : 'people'}`} />
      <View style={styles.memberList}>{circleMembers.map((member, index) => <Pressable key={member.id} style={[styles.memberRow, index === circleMembers.length - 1 && styles.memberRowLast]} onPress={() => onOpenMember(member)}><Avatar member={member} size={48} showDot={member.id !== 'maya'} /><View style={styles.memberCopy}><View style={styles.memberNameRow}><Text style={styles.memberName}>{member.name}</Text>{member.isYou && <Text style={styles.youLabel}>YOU</Text>}</View><Text style={styles.memberStatus}>{member.status} · {member.lastSeen}</Text></View><View style={styles.memberTrailing}>{member.battery > 0 && <View style={styles.batteryRow}><Icon name={member.battery > 25 ? 'battery-half' : 'battery-dead-outline'} size={15} color={member.battery > 25 ? COLORS.mint : COLORS.coral} /><Text style={styles.batteryText}>{member.battery}%</Text></View>}<Icon name="chevron-forward" size={18} color={COLORS.subtle} /></View></Pressable>)}</View>
      <Pressable style={styles.inviteButton} onPress={onInvite}><Icon name="person-add-outline" size={19} color={COLORS.coral} /><Text style={styles.inviteButtonText}>Invite a circle member</Text><Icon name="arrow-forward" size={17} color={COLORS.coral} /></Pressable>
      <SectionTitle eyebrow="PLACES" title="Saved places" action="See all" onAction={() => Alert.alert('Saved places', 'Home, school, and work can be added here in the next iteration.')} />
      <View style={styles.placeCard}><View style={[styles.placeIcon, { backgroundColor: COLORS.coralSoft }]}><Icon name="home-outline" size={20} color={COLORS.coral} /></View><View style={styles.placeCopy}><Text style={styles.placeName}>Home</Text><Text style={styles.placeAddress}>24 W 23rd Street · Manhattan</Text></View><Icon name="chevron-forward" size={18} color={COLORS.subtle} /></View>
      <View style={styles.placeCard}><View style={[styles.placeIcon, { backgroundColor: COLORS.blueSoft }]}><Icon name="briefcase-outline" size={20} color={COLORS.blue} /></View><View style={styles.placeCopy}><Text style={styles.placeName}>Work</Text><Text style={styles.placeAddress}>350 Fifth Avenue · Manhattan</Text></View><Icon name="chevron-forward" size={18} color={COLORS.subtle} /></View>
    </ScrollView>
  );
}

function ActivityScreen({ onCheckIn }: { onCheckIn: () => void }) {
  return (
    <ScrollView style={styles.contentScreen} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      <SectionTitle eyebrow="TODAY · MONDAY, SEP 21" title="Circle activity" />
      <View style={styles.activitySummary}><View style={styles.activitySummaryIcon}><Icon name="pulse" size={22} color={COLORS.mint} /></View><View style={styles.activitySummaryCopy}><Text style={styles.activitySummaryTitle}>A quiet day in your circle</Text><Text style={styles.activitySummaryText}>No safety alerts or unusual activity.</Text></View><Pill label="All clear" /></View>
      <Text style={styles.timelineLabel}>RECENT UPDATES</Text>
      <View style={styles.timeline}><ActivityItem icon="location" tone="blue" time="12:42 PM" title="You arrived at Work" body="350 Fifth Avenue" /><ActivityItem icon="car" tone="coral" time="11:18 AM" title="Maya started a drive" body="12 min · 2.4 mi" /><ActivityItem icon="home" tone="mint" time="9:05 AM" title="Alex arrived at Home" body="24 W 23rd Street" /><ActivityItem icon="checkmark-circle" tone="yellow" time="8:31 AM" title="Maya checked in" body="'Made it to school!'" isLast /></View>
      <Pressable style={styles.fullWidthAction} onPress={onCheckIn}><Icon name="checkmark-circle-outline" size={19} color={COLORS.coral} /><Text style={styles.fullWidthActionText}>Send a check-in to your circle</Text><Icon name="arrow-forward" size={17} color={COLORS.coral} /></Pressable>
    </ScrollView>
  );
}

function ActivityItem({ icon, tone, time, title, body, isLast = false }: { icon: IconName; tone: 'blue' | 'coral' | 'mint' | 'yellow'; time: string; title: string; body: string; isLast?: boolean }) {
  const palette = { blue: COLORS.blue, coral: COLORS.coral, mint: COLORS.mint, yellow: COLORS.yellow }[tone];
  const iconName = `${icon}-outline` as IconName;
  return <View style={styles.timelineItem}><View style={styles.timelineRail}><View style={[styles.timelineIcon, { backgroundColor: tone === 'blue' ? COLORS.blueSoft : tone === 'coral' ? COLORS.coralSoft : tone === 'mint' ? COLORS.mintSoft : COLORS.yellowSoft }]}><Icon name={iconName} size={17} color={palette} /></View>{!isLast && <View style={styles.timelineLine} />}</View><View style={styles.timelineCopy}><Text style={styles.timelineTime}>{time}</Text><Text style={styles.timelineTitle}>{title}</Text><Text style={styles.timelineBody}>{body}</Text></View></View>;
}

function YouScreen({ locationEnabled, backgroundReady, onToggleLocation, onBackgroundLocation, circle, onRelaySetup, onInvite, onJoin }: { locationEnabled: boolean; backgroundReady: boolean; onToggleLocation: () => void; onBackgroundLocation: () => void; circle: CircleConfig | null; onRelaySetup: () => void; onInvite: () => void; onJoin: () => void }) {
  return (
    <ScrollView style={styles.contentScreen} contentContainerStyle={styles.contentContainer} showsVerticalScrollIndicator={false}>
      <SectionTitle eyebrow="YOUR PROFILE" title="You" action="Edit" onAction={() => Alert.alert('Edit profile', 'Profile editing will be connected to accounts in the next step.')} />
      <View style={styles.profileCard}><Avatar member={members[0]} size={68} /><View style={styles.profileCopy}><Text style={styles.profileName}>Jordan Rivera</Text><Text style={styles.profileEmail}>Local preview · no account yet</Text><View style={styles.profileStatus}><View style={styles.profileStatusDot} /><Text style={styles.profileStatusText}>Sharing with Northstar Circle</Text></View></View><Icon name="chevron-forward" size={19} color={COLORS.subtle} /></View>
      <SectionTitle eyebrow="LOCATION" title="Sharing controls" />
      <View style={styles.settingsCard}>
        <View style={styles.settingRow}><View style={[styles.settingIcon, { backgroundColor: COLORS.coralSoft }]}><Icon name="location" size={19} color={COLORS.coral} /></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>Location sharing</Text><Text style={styles.settingDescription}>{locationEnabled ? 'Your circle can see your live location' : 'Your location is currently paused'}</Text></View><Switch value={locationEnabled} onValueChange={onToggleLocation} trackColor={{ false: '#D6DCE5', true: '#FFB8B1' }} thumbColor={locationEnabled ? COLORS.coral : '#FFFFFF'} /></View>
        <View style={styles.settingsDivider} />
        <Pressable style={styles.settingRow} onPress={onBackgroundLocation}><View style={[styles.settingIcon, { backgroundColor: COLORS.blueSoft }]}><Icon name="navigate" size={19} color={COLORS.blue} /></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>Background updates</Text><Text style={styles.settingDescription}>{backgroundReady ? 'Ready for a development build' : 'Works when the app is open in Expo Go'}</Text></View><View style={[styles.statusCheck, { backgroundColor: backgroundReady ? COLORS.mintSoft : COLORS.yellowSoft }]}><Icon name={backgroundReady ? 'checkmark' : 'information'} size={15} color={backgroundReady ? COLORS.mint : '#C88313'} /></View></Pressable>
      </View>
      <View style={styles.privacyNote}><Icon name="lock-closed-outline" size={17} color={COLORS.muted} /><Text style={styles.privacyText}>Your location is shared only with members of your circle. You can pause sharing any time.</Text></View>
      <SectionTitle eyebrow="SELF-HOSTED" title="Private relay" action={circle?.isOwner ? 'Invite' : undefined} onAction={onInvite} />
      <View style={styles.settingsCard}>
        <Pressable style={styles.settingRow} onPress={onRelaySetup}>
          <View style={[styles.settingIcon, { backgroundColor: circle ? COLORS.mintSoft : COLORS.coralSoft }]}><Icon name={circle ? 'shield-checkmark-outline' : 'server-outline'} size={19} color={circle ? COLORS.mint : COLORS.coral} /></View>
          <View style={styles.settingCopy}><Text style={styles.settingTitle}>{circle ? circle.circleName : 'Set up a private relay'}</Text><Text style={styles.settingDescription}>{circle ? `${circle.isOwner ? 'Circle owner' : 'Circle member'} · encrypted relay connected` : 'Host your own relay—no account or shared database'}</Text></View><Icon name="chevron-forward" size={18} color={COLORS.subtle} />
        </Pressable>
        {!circle && <><View style={styles.settingsDivider} /><Pressable style={styles.settingRow} onPress={onJoin}><View style={[styles.settingIcon, { backgroundColor: COLORS.blueSoft }]}><Icon name="qr-code-outline" size={19} color={COLORS.blue} /></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>Join with invitation QR</Text><Text style={styles.settingDescription}>No sign-up needed</Text></View><Icon name="chevron-forward" size={18} color={COLORS.subtle} /></Pressable></>}
      </View>
      <SectionTitle eyebrow="APP" title="Preferences" />
      <View style={styles.settingsCard}><SettingLink icon="notifications-outline" title="Notifications" description="Alerts, check-ins, and arrival updates" /><View style={styles.settingsDivider} /><SettingLink icon="help-circle-outline" title="Help & support" description="Learn how Free360 keeps you connected" /><View style={styles.settingsDivider} /><SettingLink icon="shield-checkmark-outline" title="Privacy & safety" description="Your data and sharing choices" /></View>
      <Text style={styles.versionText}>Free360 preview · v0.1.0</Text>
    </ScrollView>
  );
}

function SettingLink({ icon, title, description }: { icon: IconName; title: string; description: string }) {
  return <View style={styles.settingRow}><View style={[styles.settingIcon, { backgroundColor: COLORS.canvas }]}><Icon name={icon} size={19} color={COLORS.ink} /></View><View style={styles.settingCopy}><Text style={styles.settingTitle}>{title}</Text><Text style={styles.settingDescription}>{description}</Text></View><Icon name="chevron-forward" size={18} color={COLORS.subtle} /></View>;
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
  const [backgroundReady, setBackgroundReady] = useState(false);
  const [currentCoordinate, setCurrentCoordinate] = useState(members[0].coordinate);
  const [circle, setCircle] = useState<CircleConfig | null>(null);
  const [remoteLocations, setRemoteLocations] = useState<Record<string, SharedLocation>>({});
  const [checkInVisible, setCheckInVisible] = useState(false);
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [toast, setToast] = useState('');
  const watcher = useRef<Location.LocationSubscription | null>(null);
  const circleRef = useRef<CircleConfig | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => () => { watcher.current?.remove(); }, []);

  useEffect(() => {
    void loadCircle().then((savedCircle) => {
      setCircle(savedCircle);
      circleRef.current = savedCircle;
    });
  }, [pathname]);

  useEffect(() => {
    if (!circle) {
      setRemoteLocations({});
      return;
    }
    let disposed = false;
    let subscription: { close: () => void } | null = null;
    void subscribeToCircle(circle, (deviceId, location) => {
      if (!disposed && deviceId !== circle.deviceId) setRemoteLocations((current) => ({ ...current, [deviceId]: location }));
    }).then((createdSubscription) => {
      if (disposed) createdSubscription.close();
      else subscription = createdSubscription;
    }).catch((error) => console.warn('[Free360] Could not subscribe to relay updates:', error));
    return () => {
      disposed = true;
      subscription?.close();
    };
  }, [circle?.circleId, circle?.deviceId, circle?.deviceToken, circle?.encryptionKey, circle?.relayUrl]);

  const mapMembers = useMemo(() => {
    if (!circle) return members;
    const localMember = { ...members[0], coordinate: currentCoordinate, status: locationEnabled ? 'Sharing securely' : 'Sharing paused' };
    const remoteMembers = Object.entries(remoteLocations).map(([deviceId, location], index) => ({
      id: deviceId,
      name: `Circle member ${index + 1}`,
      initials: `M${index + 1}`,
      role: 'Private relay member',
      status: 'Sharing securely',
      lastSeen: `Updated ${new Date(location.recordedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`,
      coordinate: { latitude: location.latitude, longitude: location.longitude },
      color: ['#6B78E5', '#F19A5A', '#49A995', '#4386F4'][index % 4],
      battery: 0,
    }));
    return [localMember, ...remoteMembers];
  }, [circle, currentCoordinate, locationEnabled, remoteLocations]);

  const shareLocation = (position: Location.LocationObject) => {
    const currentCircle = circleRef.current;
    if (!currentCircle) return;
    void publishLocation(currentCircle, {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
    }).catch((error) => console.warn('[Free360] Could not publish foreground location:', error));
  };

  const requestLocation = async () => {
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
      shareLocation(current);
      if (!watcher.current) {
        watcher.current = await Location.watchPositionAsync({ accuracy: Location.Accuracy.Balanced, distanceInterval: 20, timeInterval: 15000 }, (position) => {
          setCurrentCoordinate({ latitude: position.coords.latitude, longitude: position.coords.longitude });
          shareLocation(position);
        });
      }

      try {
        const background = await Location.requestBackgroundPermissionsAsync();
        if (background.status === 'granted') {
          await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, { accuracy: Location.Accuracy.Balanced, distanceInterval: 50, timeInterval: 30000, pausesUpdatesAutomatically: false, showsBackgroundLocationIndicator: true, foregroundService: { notificationTitle: 'Free360 location sharing', notificationBody: 'Your Northstar Circle can see your live location.', notificationColor: COLORS.coral } });
          setBackgroundReady(true);
        } else {
          setBackgroundReady(false);
          setToast('Sharing is on while Free360 is open. Background access needs permission.');
        }
      } catch {
        setBackgroundReady(false);
        setToast('Foreground sharing is on. Use a development build for background updates.');
      }
      setLocationEnabled(true);
      setToast('Location sharing is on.');
    } catch {
      setToast('We couldn’t access your location. Check device permissions.');
    }
  };

  const stopLocation = async () => {
    watcher.current?.remove();
    watcher.current = null;
    try {
      if (await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    } catch {
      // Expo Go does not expose the background service; foreground sharing can still stop cleanly.
    }
    setLocationEnabled(false);
    setBackgroundReady(false);
    setToast('Location sharing is paused.');
  };

  const toggleLocation = () => { if (locationEnabled) void stopLocation(); else void requestLocation(); };
  const invite = () => {
    if (!circle) {
      router.push('/relay');
      return;
    }
    if (!circle.isOwner) {
      setToast('Only the phone that created this circle can make invitations.');
      return;
    }
    router.push('/invite');
  };
  const checkIn = (message: string) => { setCheckInVisible(false); setToast(message || 'You checked in with your circle.'); };

  const content = useMemo(() => {
    if (activeTab === 'map') return <MapScreen currentCoordinate={currentCoordinate} locationEnabled={locationEnabled} circleName={circle?.circleName ?? 'Northstar Circle'} circleMembers={mapMembers} onRequestLocation={requestLocation} onCheckIn={() => setCheckInVisible(true)} onRecenter={() => setToast('Map centered on your location.')} onOpenMember={setSelectedMember} />;
    if (activeTab === 'circle') return <CircleScreen circleMembers={mapMembers} circleName={circle?.circleName ?? 'Northstar Circle'} onInvite={invite} onOpenMember={setSelectedMember} />;
    if (activeTab === 'activity') return <ActivityScreen onCheckIn={() => setCheckInVisible(true)} />;
    return <YouScreen locationEnabled={locationEnabled} backgroundReady={backgroundReady} onToggleLocation={toggleLocation} onBackgroundLocation={() => setToast('Background location is wired for the development-build step.')} circle={circle} onRelaySetup={() => circle ? setToast('Your self-hosted relay is connected.') : router.push('/relay')} onInvite={invite} onJoin={() => router.push('/join')} />;
  }, [activeTab, backgroundReady, circle, currentCoordinate, locationEnabled, mapMembers, router]);

  return <SafeAreaView style={styles.appRoot}><StatusBar style="dark" /><Header circleName={circle?.circleName ?? 'Northstar Circle'} onSettings={() => router.replace('/you')} /><View style={styles.mainContent}>{content}</View><BottomTabs activeTab={activeTab} onTabChange={(tab) => router.replace(`/${tab}`)} />{Boolean(toast) && <View style={styles.toast}><Icon name="information-circle" size={18} color={COLORS.white} /><Text style={styles.toastText}>{toast}</Text></View>}<CheckInModal visible={checkInVisible} onClose={() => setCheckInVisible(false)} onConfirm={checkIn} /><MemberModal member={selectedMember} onClose={() => setSelectedMember(null)} /></SafeAreaView>;
}

const styles = StyleSheet.create({
  appRoot: { flex: 1, backgroundColor: COLORS.canvas },
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
