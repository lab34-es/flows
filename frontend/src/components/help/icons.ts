import {
  AppWindow,
  Braces,
  CheckCircle2,
  FileText,
  FolderTree,
  Ghost,
  Globe,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  MessageCircleQuestion,
  Play,
  Radio,
  Rocket,
  Share2,
  Shield,
  Sparkles,
  Terminal,
  Ticket,
  Wand2,
} from 'lucide-react';

/**
 * The icons an article can pick through its `icon` frontmatter key. Anything
 * unknown falls back to a plain file — see `iconFor`.
 */
export const ICONS = {
  app: AppWindow,
  check: CheckCircle2,
  code: Braces,
  file: FileText,
  folder: FolderTree,
  ghost: Ghost,
  globe: Globe,
  key: KeyRound,
  layout: LayoutDashboard,
  'life-buoy': LifeBuoy,
  message: MessageCircleQuestion,
  play: Play,
  radio: Radio,
  rocket: Rocket,
  share: Share2,
  shield: Shield,
  sparkles: Sparkles,
  terminal: Terminal,
  ticket: Ticket,
  wand: Wand2,
};

export const iconFor = (name: string) => ICONS[name] || FileText;

export default ICONS;
