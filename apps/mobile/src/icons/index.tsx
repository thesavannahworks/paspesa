/**
 * Paspesa icon library — SVG traces of the reference-screenshot icons
 * (green outline #36A839 with red accents #E92536, rounded 1.7px strokes on a 24px grid).
 *
 * Brand marks (M-PESA, PATA MORE, ZiiDi, Shiriki Pay, Bonga, Safaricom) are NOT reproduced;
 * neutral `Placeholder*` icons hold their positions (White Paper §40).
 */
import Svg, { Circle, G, Path, Rect, Text as SvgText } from 'react-native-svg';

export const ICON_GREEN = '#36A839';
export const ICON_RED = '#E92536';

export interface IconProps {
  size?: number;
  /** Primary (outline) colour. */
  color?: string;
  /** Accent colour. */
  accent?: string;
  strokeWidth?: number;
}

type IconComponent = (props: IconProps) => React.JSX.Element;

function make(render: (c: string, a: string) => React.ReactNode, defaults: { color?: string; accent?: string } = {}): IconComponent {
  return function Icon({ size = 24, color, accent, strokeWidth = 1.7 }: IconProps) {
    const c = color ?? defaults.color ?? ICON_GREEN;
    const a = accent ?? defaults.accent ?? ICON_RED;
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <G strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
          {render(c, a)}
        </G>
      </Svg>
    );
  };
}

// ---------------------------------------------------------------- quick actions

export const SendMoneyIcon = make((c, a) => (
  <>
    <Path d="M20.4 3.6 3.9 9.9a.5.5 0 0 0 0 .93l6.6 2.6 2.6 6.6a.5.5 0 0 0 .93 0L20.4 3.6Z" stroke={c} />
    <Path d="M10.5 13.4 14.2 9.8" stroke={a} />
  </>
));

export const LipaIcon = make((c, a) => (
  <>
    <Path d="M7.6 7.2V5.4c0-.5.4-.9.9-.9h7c.5 0 .9.4.9.9v1.8" stroke={a} />
    <Rect x={2.8} y={7.4} width={18.4} height={3.2} rx={1} stroke={c} />
    <Path d="m4.6 10.6 1.3 8a1.6 1.6 0 0 0 1.6 1.4h9a1.6 1.6 0 0 0 1.6-1.4l1.3-8" stroke={c} />
    <Path d="M9.4 13.6v3.2M12 13.6v3.2M14.6 13.6v3.2" stroke={c} />
  </>
));

export const WithdrawIcon = make((c, a) => (
  <>
    <Path d="M20 11.5V6.2A1.7 1.7 0 0 0 18.3 4.5H4.7A1.7 1.7 0 0 0 3 6.2v10.1A1.7 1.7 0 0 0 4.7 18H12" stroke={c} />
    <Rect x={5.6} y={7.6} width={4.6} height={3.6} rx={0.9} stroke={c} />
    <Circle cx={7.9} cy={9.4} r={0.5} fill={c} stroke="none" />
    <Path d="M17.2 12.6v7.2M14.4 17.2l2.8 2.8 2.8-2.8" stroke={a} />
  </>
));

export const AirtimeIcon = make((c, a) => (
  <>
    <Path d="M5.4 4.3h2.3c.3 0 .6.2.7.5l1.1 3a.8.8 0 0 1-.3.9l-1.5 1a11.4 11.4 0 0 0 6.6 6.6l1-1.5a.8.8 0 0 1 .9-.3l3 1.1c.3.1.5.4.5.7v2.3a1.8 1.8 0 0 1-1.9 1.8C10.7 19.8 4.2 13.3 3.6 6.2a1.8 1.8 0 0 1 1.8-1.9Z" stroke={c} />
    <Path d="M15.4 3.6h5v5" stroke={a} />
  </>
));

export const GiftIcon = make((c, a) => (
  <>
    <Rect x={3.6} y={8.6} width={16.8} height={3.6} rx={1} stroke={c} />
    <Path d="M5.2 12.2v6.6c0 .9.7 1.6 1.6 1.6h10.4c.9 0 1.6-.7 1.6-1.6v-6.6" stroke={c} />
    <Path d="M12 8.6 9.4 5.2a1.3 1.3 0 0 0-2 .2c-.5.8 0 1.9 1 2.2l3.6 1M12 8.6l2.6-3.4a1.3 1.3 0 0 1 2 .2c.5.8 0 1.9-1 2.2l-3.6 1" stroke={c} />
    <Path d="M10.4 12.2v5l1.6-1.2 1.6 1.2v-5" stroke={a} />
  </>
));

export const HomeInternetIcon = make((c, a) => (
  <>
    <Path d="M11.1 3.6a1.5 1.5 0 0 1 1.8 0l6.9 5c.5.4.7 1 .6 1.6l-1.6 8.5c-.1.7-.8 1.3-1.5 1.3H6.7c-.7 0-1.4-.6-1.5-1.3L3.6 10.2c-.1-.6.1-1.2.6-1.6l6.9-5Z" stroke={c} />
    <Path d="M8.6 13a4.8 4.8 0 0 1 6.8 0M10.3 14.8a2.4 2.4 0 0 1 3.4 0" stroke={a} />
    <Circle cx={12} cy={16.6} r={0.55} fill={a} stroke="none" />
  </>
));

// ---------------------------------------------------------------- header / navigation

export const BellIcon = make((c, a) => (
  <>
    <Path d="M6.2 16.6v-5.2a5.8 5.8 0 0 1 11.6 0v5.2l1.4 1.6H4.8l1.4-1.6Z" stroke={c} />
    <Path d="M10 18.4a2 2 0 0 0 4 0" stroke={c} />
    <Path d="M12 8.6v2.8" stroke={a} />
  </>
));

export const SearchIcon = make((c, a) => (
  <>
    <Circle cx={10.8} cy={10.8} r={6.6} stroke={c} />
    <Path d="m16.3 16.3 3.6 3.6" stroke={a} />
  </>
));

export const EyeIcon = make((c) => (
  <>
    <Path d="M2.8 12c2-4 5.2-6.2 9.2-6.2s7.2 2.2 9.2 6.2c-2 4-5.2 6.2-9.2 6.2S4.8 16 2.8 12Z" stroke={c} />
    <Circle cx={12} cy={12} r={3} stroke={c} />
  </>
), { color: '#8E8E8E' });

export const EyeOffIcon = make((c) => (
  <>
    <Path d="M6.2 16.4C4.8 15.4 3.7 13.9 2.8 12c2-4 5.2-6.2 9.2-6.2 1.6 0 3 .3 4.3 1M18.6 8.4c1 1 1.9 2.2 2.6 3.6-2 4-5.2 6.2-9.2 6.2-1.1 0-2.1-.2-3.1-.5" stroke={c} />
    <Path d="M9.4 13.6A3 3 0 0 1 13.6 9.4M15 12a3 3 0 0 1-3 3" stroke={c} />
    <Path d="M19.2 4.8 4.8 19.2" stroke={c} />
  </>
), { color: '#8E8E8E' });

export const ChevronLeftIcon = make((c) => <Path d="m14.5 5.5-6.5 6.5 6.5 6.5" stroke={c} />, { color: '#222222' });
export const ChevronRightIcon = make((c) => <Path d="m9.5 5.5 6.5 6.5-6.5 6.5" stroke={c} />, { color: '#222222' });
export const ChevronUpIcon = make((c) => <Path d="m5.5 14.5 6.5-6.5 6.5 6.5" stroke={c} />, { color: '#222222' });
export const ChevronDownIcon = make((c) => <Path d="m5.5 9.5 6.5 6.5 6.5-6.5" stroke={c} />, { color: '#222222' });

export const CloseIcon = make((c, a) => (
  <>
    <Path d="M6 6l12 12" stroke={c} />
    <Path d="M18 6 6 18" stroke={a} />
  </>
));

// ---------------------------------------------------------------- forms

export const ContactIcon = make((c, a) => (
  <>
    <Rect x={3.6} y={3.6} width={16.8} height={16.8} rx={5} stroke={c} />
    <Circle cx={12} cy={10} r={2.6} stroke={a} />
    <Path d="M6.6 19.4c1.1-2 3.1-3.2 5.4-3.2s4.3 1.2 5.4 3.2" stroke={c} />
  </>
));

export const ScanIcon = make((c, a) => (
  <>
    <Path d="M3.6 7.6V5a1.4 1.4 0 0 1 1.4-1.4h2.6M16.4 3.6H19A1.4 1.4 0 0 1 20.4 5v2.6M20.4 16.4V19a1.4 1.4 0 0 1-1.4 1.4h-2.6M7.6 20.4H5A1.4 1.4 0 0 1 3.6 19v-2.6" stroke={a} />
    <Rect x={6.8} y={6.8} width={3.4} height={3.4} rx={0.6} stroke={c} strokeWidth={1.4} />
    <Rect x={13.8} y={6.8} width={3.4} height={3.4} rx={0.6} stroke={c} strokeWidth={1.4} />
    <Rect x={6.8} y={13.8} width={3.4} height={3.4} rx={0.6} stroke={c} strokeWidth={1.4} />
    <Path d="M12 6.8v2.4M13.8 12H17M12 12h-.2M14 15.2h1.6v2" stroke={c} strokeWidth={1.4} />
  </>
));

export const PlusIcon = make((c, a) => (
  <>
    <Path d="M12 5v14" stroke={c} />
    <Path d="M5 12h14" stroke={a} />
  </>
));

export const BackspaceIcon = make((c, a) => (
  <>
    <Path d="M8.4 5.6h10.2a1.8 1.8 0 0 1 1.8 1.8v9.2a1.8 1.8 0 0 1-1.8 1.8H8.4L3.6 12l4.8-6.4Z" stroke={c} />
    <Path d="m11.4 9.6 4.8 4.8M16.2 9.6l-4.8 4.8" stroke={a} />
  </>
));

// ---------------------------------------------------------------- result / detail actions

export const StarIcon = make((c) => (
  <Path d="m12 3.6 2.5 5.1 5.6.8c.4.1.6.6.3.9l-4.1 4 1 5.6c.1.4-.4.8-.8.6L12 18l-5 2.6c-.4.2-.9-.1-.8-.6l1-5.6-4.1-4c-.3-.3-.1-.8.3-.9l5.6-.8L11.5 3.6c.2-.4.8-.4 1 0Z" stroke={c} />
));

export const StarFilledIcon = make((c, a) => (
  <>
    <Path d="m12 3.6 2.5 5.1 5.6.8c.4.1.6.6.3.9l-4.1 4 1 5.6c.1.4-.4.8-.8.6L12 18l-5 2.6c-.4.2-.9-.1-.8-.6l1-5.6-4.1-4c-.3-.3-.1-.8.3-.9l5.6-.8L11.5 3.6c.2-.4.8-.4 1 0Z" fill={a} stroke={a} />
    <Path d="M12 18v-6.6l4.4-1.6 3.7-.3c.4.1.6.6.3.9l-4.1 4 1 5.6c.1.4-.4.8-.8.6L12 18Z" fill={c} stroke={c} />
  </>
));

export const ReverseIcon = make((c) => (
  <>
    <Path d="M7.4 6.6A7.6 7.6 0 1 1 4.6 13" stroke={c} />
    <Path d="M10 3.4 7.2 6.6l3.2 2.6" stroke={c} />
  </>
));

export const ScheduleIcon = make((c, a) => (
  <>
    <Path d="M20.2 11.4V7.2a2.6 2.6 0 0 0-2.6-2.6H6.4a2.6 2.6 0 0 0-2.6 2.6v10.4a2.6 2.6 0 0 0 2.6 2.6h5.2" stroke={c} />
    <Path d="M8 3v3.2M16 3v3.2" stroke={c} />
    <Path d="M3.8 9.2h16.4" stroke={a} />
    <Path d="M7.6 12.6h.4M10.4 12.6h.4M7.6 15.4h.4" stroke={a} strokeWidth={2.2} />
    <Path d="m15.6 20.4 4.8-4.8a1.3 1.3 0 0 0-1.8-1.8l-4.8 4.8-.5 2.3 2.3-.5Z" stroke={c} />
  </>
));

export const ReceiptIcon = make((c, a) => (
  <>
    <Path d="M14.6 3.6H8.2a4.6 4.6 0 0 0-4.6 4.6v7.6a4.6 4.6 0 0 0 4.6 4.6h7.6a4.6 4.6 0 0 0 4.6-4.6V9.4l-5.8-5.8Z" stroke={c} />
    <Path d="M14.6 3.6v2.6a3.2 3.2 0 0 0 3.2 3.2h2.6" stroke={c} />
    <Path d="M9 12.4h5" stroke={a} />
    <Path d="M9 15.6h3" stroke={c} />
  </>
));

export const ShareIcon = make((c, a) => (
  <>
    <Circle cx={6} cy={12} r={2.2} stroke={a} />
    <Circle cx={17.6} cy={5.6} r={2.2} stroke={c} />
    <Circle cx={17.6} cy={18.4} r={2.2} stroke={c} />
    <Path d="m8 10.9 7.6-4.2M8 13.1l7.6 4.2" stroke={c} />
  </>
));

export const CopyIcon = make((c, a) => (
  <>
    <Rect x={8.6} y={8.6} width={11.8} height={11.8} rx={3} stroke={a} />
    <Path d="M15.4 8.6V6.6a3 3 0 0 0-3-3H6.6a3 3 0 0 0-3 3v5.8a3 3 0 0 0 3 3h2" stroke={a} />
  </>
), { color: ICON_RED });

// ---------------------------------------------------------------- statements

export const ExportIcon = make((c, a) => (
  <>
    <Path d="M8.2 9.4H6.6a3 3 0 0 0-3 3v4.6a3 3 0 0 0 3 3h10.8a3 3 0 0 0 3-3v-4.6a3 3 0 0 0-3-3h-1.6" stroke={c} />
    <Path d="M12 14V3.6M8.6 7 12 3.6 15.4 7" stroke={a} />
  </>
));

export const SpendIcon = make((c, a) => (
  <>
    <Path d="M11 5.2a7.6 7.6 0 1 0 8.4 8.4" stroke={c} />
    <Path d="M14.2 3.6a6.6 6.6 0 0 1 6.2 6.2h-5.4a.8.8 0 0 1-.8-.8V3.6Z" stroke={a} />
  </>
));

export const VerifiedIcon = make((c, a) => (
  <>
    <Path d="M10.6 3.2a2 2 0 0 1 2.8 0l1 .9c.4.4 1 .5 1.5.5l1.4-.1a2 2 0 0 1 2 2l-.1 1.4c0 .5.1 1.1.5 1.5l.9 1a2 2 0 0 1 0 2.8l-.9 1c-.4.4-.5 1-.5 1.5l.1 1.4a2 2 0 0 1-2 2l-1.4-.1c-.5 0-1.1.1-1.5.5l-1 .9a2 2 0 0 1-2.8 0l-1-.9c-.4-.4-1-.5-1.5-.5l-1.4.1a2 2 0 0 1-2-2l.1-1.4c0-.5-.1-1.1-.5-1.5l-.9-1a2 2 0 0 1 0-2.8l.9-1c.4-.4.5-1 .5-1.5l-.1-1.4a2 2 0 0 1 2-2l1.4.1c.5 0 1.1-.1 1.5-.5l1-.9Z" stroke={c} />
    <Path d="m8.8 12 2.2 2.2 4.2-4.4" stroke={a} />
  </>
));

// ---------------------------------------------------------------- profile / settings

export const SunIcon = make((c, a) => (
  <>
    <Circle cx={12} cy={12} r={4.6} stroke={c} />
    <Path d="M12 2.8v.6M12 20.6v.6M2.8 12h.6M20.6 12h.6M5.5 5.5l.4.4M18.1 18.1l.4.4M5.5 18.5l.4-.4M18.1 5.9l.4-.4" stroke={a} />
  </>
));

export const MoonIcon = make((c) => (
  <Path d="M19.6 14.6A7.8 7.8 0 0 1 9.4 4.4a7.8 7.8 0 1 0 10.2 10.2Z" stroke={c} />
), { color: '#CFCFCF' });

export const GearIcon = make((c) => (
  <>
    <Circle cx={12} cy={12} r={2.8} stroke={c} />
    <Path d="M10.4 3.6h3.2l.5 2.2 1.6.9 2.1-.7 1.6 2.8-1.6 1.5v1.4l1.6 1.5-1.6 2.8-2.1-.7-1.6.9-.5 2.2h-3.2l-.5-2.2-1.6-.9-2.1.7-1.6-2.8 1.6-1.5v-1.4L4.6 8.8l1.6-2.8 2.1.7 1.6-.9.5-2.2Z" stroke={c} />
  </>
), { color: '#CFCFCF' });

export const FingerprintIcon = make((c, a) => (
  <>
    <Circle cx={12} cy={12} r={8.6} stroke={c} />
    <Path d="M8.4 14.2v-2.4a3.6 3.6 0 0 1 7.2 0v1.4M10.4 16.4v-4.4a1.6 1.6 0 0 1 3.2 0v4" stroke={a} />
  </>
));

export const InfoIcon = make((c) => (
  <>
    <Circle cx={12} cy={12} r={8.6} stroke={c} />
    <Path d="M12 11v5M12 7.8v.2" stroke={c} />
  </>
));

export const CameraIcon = make((c, a) => (
  <>
    <Path d="M8.4 6.6 9.6 4.8h4.8l1.2 1.8h2.2a2.2 2.2 0 0 1 2.2 2.2v8.6a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 17.4V8.8a2.2 2.2 0 0 1 2.2-2.2h2.2Z" stroke={c} />
    <Circle cx={12} cy={12.8} r={3} stroke={a} />
  </>
));

export const LockIcon = make((c, a) => (
  <>
    <Rect x={4.6} y={10.4} width={14.8} height={10} rx={2.6} stroke={c} />
    <Path d="M8 10.4V7.8a4 4 0 0 1 8 0v2.6" stroke={c} />
    <Path d="M12 14.2v2.4" stroke={a} />
  </>
));

/** General Operations — no reference icon; drawn in the same style. */
export const WalletIcon = make((c, a) => (
  <>
    <Path d="M18.6 7.6V6.2a1.8 1.8 0 0 0-1.8-1.8H5.4a1.8 1.8 0 0 0-1.8 1.8v11.6a1.8 1.8 0 0 0 1.8 1.8h13.2a1.8 1.8 0 0 0 1.8-1.8v-8.4a1.8 1.8 0 0 0-1.8-1.8H5.4" stroke={c} />
    <Path d="M16.4 13.6h.2" stroke={a} strokeWidth={2.4} />
  </>
));

/** Recharge — wallet with incoming arrow, same style. */
export const RechargeIcon = make((c, a) => (
  <>
    <Path d="M20 12V6.2a1.7 1.7 0 0 0-1.7-1.7H4.7A1.7 1.7 0 0 0 3 6.2v10.1A1.7 1.7 0 0 0 4.7 18H12" stroke={c} />
    <Path d="M3 8.6h17" stroke={c} />
    <Path d="M17.2 20.2V13M14.4 15.8l2.8-2.8 2.8 2.8" stroke={a} />
  </>
));

export const AirtimeResetIcon = make((c, a) => (
  <>
    <Path d="M5.4 4.3h2.3c.3 0 .6.2.7.5l1.1 3a.8.8 0 0 1-.3.9l-1.5 1a11.4 11.4 0 0 0 6.6 6.6l1-1.5a.8.8 0 0 1 .9-.3l3 1.1c.3.1.5.4.5.7v2.3a1.8 1.8 0 0 1-1.9 1.8C10.7 19.8 4.2 13.3 3.6 6.2a1.8 1.8 0 0 1 1.8-1.9Z" stroke={c} />
    <Path d="M14.6 7.4a3.4 3.4 0 1 1 1.2 3M14.4 4.8v2.6H17" stroke={a} />
  </>
));

export const MessageIcon = make((c, a) => (
  <>
    <Path d="M4 6.4A2.4 2.4 0 0 1 6.4 4h11.2A2.4 2.4 0 0 1 20 6.4v8.2a2.4 2.4 0 0 1-2.4 2.4H9.4L5.2 20v-3H6.4" stroke={c} />
    <Path d="M8 9h8M8 12.2h5" stroke={a} />
  </>
));

// ---------------------------------------------------------------- "Do more" tiles (inert features)

export const SendToManyIcon = make((c, a) => (
  <>
    <Circle cx={7} cy={7} r={2.2} stroke={c} />
    <Circle cx={17} cy={7} r={2.2} stroke={c} />
    <Circle cx={12} cy={15.4} r={2.2} stroke={a} />
    <Path d="M3.4 12.4c.7-1.4 2-2.2 3.6-2.2s2.9.8 3.6 2.2M13.4 12.4c.7-1.4 2-2.2 3.6-2.2s2.9.8 3.6 2.2M8.4 20.8c.7-1.4 2-2.2 3.6-2.2s2.9.8 3.6 2.2" stroke={c} />
  </>
));

export const RequestMoneyIcon = make((c, a) => (
  <>
    <Path d="M12.4 17.6H4.7A1.7 1.7 0 0 1 3 15.9V5.8a1.7 1.7 0 0 1 1.7-1.7h13.6A1.7 1.7 0 0 1 20 5.8v5.4" stroke={c} />
    <Rect x={5.6} y={7.2} width={4.6} height={3.6} rx={0.9} stroke={c} />
    <Path d="M17.2 20.4v-7.2M14.4 16l2.8-2.8 2.8 2.8" stroke={a} />
  </>
));

export const BillManagerIcon = make((c, a) => (
  <>
    <Path d="M5 4.4h14v10.4c0 2.6-3.2 4.4-7 5.6-3.8-1.2-7-3-7-5.6V4.4Z" stroke={c} />
    <Path d="M8.6 8.6h6.8M8.6 11.6h6.8" stroke={a} />
  </>
));

export const GlobalAirtimeIcon = make((c, a) => (
  <>
    <Path d="M5.4 5.3h2.1c.3 0 .5.2.6.4l1 2.8a.7.7 0 0 1-.3.8l-1.3.9a10.4 10.4 0 0 0 6 6l.9-1.3a.7.7 0 0 1 .8-.3l2.8 1c.2.1.4.3.4.6v2.1a1.6 1.6 0 0 1-1.7 1.6C9.9 19.4 4 13.5 3.7 7a1.6 1.6 0 0 1 1.7-1.7Z" stroke={c} />
    <Circle cx={17.2} cy={6.8} r={3.2} stroke={a} />
    <Path d="M14 6.8h6.4M17.2 3.6c.9.9 1.3 2 1.3 3.2s-.4 2.3-1.3 3.2c-.9-.9-1.3-2-1.3-3.2s.4-2.3 1.3-3.2Z" stroke={a} strokeWidth={1.2} />
  </>
));

/** Frequents empty state ("It looks like you're starting fresh here."). */
export function EmptyActivityArt({ width = 120 }: { width?: number }) {
  const h = (width * 46) / 120;
  return (
    <Svg width={width} height={h} viewBox="0 0 120 46" fill="none">
      <Rect x={22} y={2} width={70} height={10} rx={5} fill="#8E8E8E" opacity={0.25} />
      <Rect x={2} y={18} width={56} height={10} rx={5} fill="#8E8E8E" opacity={0.25} />
      <Rect x={66} y={18} width={30} height={10} rx={5} fill="#8E8E8E" opacity={0.25} />
      <Circle cx={104} cy={23} r={5} fill="#8E8E8E" opacity={0.25} />
      <Rect x={14} y={34} width={64} height={10} rx={5} fill="#8E8E8E" opacity={0.25} />
      <Path d="M52 6v30M46 30l6 6 6-6" stroke={ICON_GREEN} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M64 40V10M58 16l6-6 6 6" stroke={ICON_RED} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ---------------------------------------------------------------- brand placeholders

/** Holds the M-PESA mark position (payment-method card, Pochi Wallet). Not the real logo. */
export function PlaceholderWalletMark({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={11} fill={ICON_GREEN} />
      <Path d="M7 9.4h10v6.4a1.4 1.4 0 0 1-1.4 1.4H8.4A1.4 1.4 0 0 1 7 15.8V9.4Z" fill="none" stroke="#FFFFFF" strokeWidth={1.6} strokeLinejoin="round" />
      <Path d="M9.4 9.4V8a2.6 2.6 0 0 1 5.2 0v1.4" fill="none" stroke="#FFFFFF" strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}

/** Holds a partner-logo position (PATA MORE, ZiiDi, Shiriki Pay, Bonga). Not the real logos. */
export function PlaceholderBrandMark({ size = 24, label }: { size?: number; label: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Circle cx={12} cy={12} r={11} fill="none" stroke={ICON_GREEN} strokeWidth={1.4} strokeDasharray="2 2" />
      <SvgText x={12} y={15.4} fontSize={label.length > 1 ? 7.5 : 10} fontWeight="700" fill={ICON_GREEN} textAnchor="middle">
        {label}
      </SvgText>
    </Svg>
  );
}
