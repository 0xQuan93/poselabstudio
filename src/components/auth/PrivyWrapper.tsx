import { PrivyProvider } from '@privy-io/react-auth';

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID || '';

export const PrivyWrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ['email', 'wallet', 'discord'],
        appearance: {
          theme: 'dark',
          accentColor: '#676FFF',
          logo: '/logo/poselab.svg',
        },
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
};
