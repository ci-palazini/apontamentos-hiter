// src/components/Layout.tsx
import type { ReactNode } from 'react';
import { Link, useLocation, Outlet, useNavigate } from 'react-router-dom';
import { AppShell, NavLink, Group, Text, Image, Badge, Tooltip } from '@mantine/core';
import {
  IconCalendarTime,
  IconChartHistogram,
  IconUpload,
  IconSettings,
  IconGauge,
  IconDeviceTv,
  IconSpeakerphone,
  IconBuilding,
} from '@tabler/icons-react';
import { useTenant } from '../contexts/TenantContext';

function Brand() {
  return (
    <Group gap="sm">
      <Image src="/logo.png" alt="logo" h={50} />
    </Group>
  );
}

type LinkItem = {
  label: string;
  to: string;
  icon: ReactNode;
  exact?: boolean; // quando false, marca ativo também nas subrotas
  empresaOnly?: number; // se definido, só aparece para essa empresa
};

const links: LinkItem[] = [
  {
    label: 'Visão do Dia',
    to: '/dia',
    icon: <IconCalendarTime size={16} />,
    exact: true,
  },
  {
    label: 'Gráficos',
    to: '/graficos',
    icon: <IconChartHistogram size={16} />,
    exact: true,
  },
  {
    label: 'Rendimento',
    to: '/rendimento',
    icon: <IconGauge size={16} />,
    exact: true,
  },
  {
    label: 'Upload',
    to: '/upload',
    icon: <IconUpload size={16} />,
    exact: false,
  },
  {
    label: 'Avisos TV',
    to: '/avisos',
    icon: <IconSpeakerphone size={16} />,
    exact: true,
  },
  {
    label: 'Modo TV',
    to: '/tv',
    icon: <IconDeviceTv size={16} />,
    exact: true,
  },
  {
    label: 'Configurações',
    to: '/config',
    icon: <IconSettings size={16} />,
    exact: true,
  },
];

export default function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { empresa } = useTenant();

  const isActive = (to: string, exact?: boolean) =>
    exact ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);

  return (
    <AppShell header={{ height: 56 }} navbar={{ width: 232, breakpoint: 'sm' }} padding="md">
      {/* HEADER */}
      <AppShell.Header
        withBorder
        style={{
          backdropFilter: 'saturate(180%) blur(6px)',
          background: 'rgba(255,255,255,0.85)',
        }}
      >
        <Group h="100%" px="md" justify="space-between">
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <Brand />
          </Link>
          <Group gap="xs">
            <Tooltip label="Trocar empresa">
              <Badge
                variant="light"
                color="blue"
                size="lg"
                leftSection={<IconBuilding size={14} />}
                style={{ cursor: 'pointer' }}
                onClick={() => navigate('/empresa')}
              >
                {empresa.nome}
              </Badge>
            </Tooltip>
            <Badge variant="light" color="gray">
              v0.1
            </Badge>
          </Group>
        </Group>
      </AppShell.Header>

      {/* NAVBAR */}
      <AppShell.Navbar p="xs" withBorder>
        <nav>
          {links
            .filter((l) => !l.empresaOnly || l.empresaOnly === empresa.id)
            .map((l) => (
              <NavLink
                key={l.to}
                component={Link}
                to={l.to}
                label={l.label}
                leftSection={l.icon}
                active={isActive(l.to, l.exact)}
                variant="light"
                style={{ borderRadius: 10, marginBottom: 6 }}
                styles={{ label: { fontWeight: 600 } }}
              />
            ))}
        </nav>

        <div
          style={{
            marginTop: 'auto',
            opacity: 0.6,
            fontSize: 12,
            padding: 8,
          }}
        >
          <Text c="dimmed">© {new Date().getFullYear()}</Text>
        </div>
      </AppShell.Navbar>

      {/* CONTEÚDO */}
      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}