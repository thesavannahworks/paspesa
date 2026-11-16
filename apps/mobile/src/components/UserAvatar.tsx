import { useAccount } from '@/services/AppState';
import { useProfilePhoto } from '@/services/profilePhoto';
import { Avatar } from './ui';

/** The account holder's avatar: their profile picture when set, otherwise initials. */
export function UserAvatar({ size, fontSize }: { size?: number; fontSize?: number }) {
  const account = useAccount();
  const { uri } = useProfilePhoto();
  return <Avatar name={account.accountName} size={size} fontSize={fontSize} photo={uri} />;
}
