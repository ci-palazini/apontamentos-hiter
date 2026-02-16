import { Badge, Card, Center, Divider, Group, Progress, RingProgress, ScrollArea, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import {
    IconArrowMerge, IconPin, IconAlertTriangle, IconClock
} from '@tabler/icons-react';
import type { CentroPerf } from '../types';
import { perfColor, formatNum, clamp } from '../utils';

export function SlideMaquinas({ page, isFuture }: { page: CentroPerf[]; isFuture: boolean }) {
    if (!page.length) return <Center h="100%"><Text c="dimmed">Nenhuma máquina.</Text></Center>;
    return (
        <Stack gap="md" h="100%">
            <Title order={2}>Performance por Máquina • Visão do Dia</Title>
            <SimpleGrid cols={3} spacing="lg" verticalSpacing="lg" style={{ flex: 1 }}>
                {page.map((c) => {
                    const pctEsperado = c.esperado_dia > 0 ? (c.real_dia / c.esperado_dia) * 100 : 0;
                    const cor = perfColor(c.ader_dia);
                    return (
                        <Card key={c.centro_id} withBorder radius="lg" padding="lg" style={{ display: 'flex', flexDirection: 'column' }}>
                            <Stack gap="md" h="100%">
                                <Group justify="space-between" align="flex-start">
                                    <Stack gap={0}>
                                        <Group gap={4}><Text fw={900} size="xl" style={{ fontSize: '1.6rem' }}>{c.codigo}</Text>{c.is_parent && <IconArrowMerge size={22} color="gray" />}{c.pinned && <IconPin size={22} color="gray" />}</Group>
                                        {c.is_stale && <Badge variant="filled" color="orange" size="sm" leftSection={<IconAlertTriangle size={12} />}>Dados de {c.last_ref_time}</Badge>}
                                    </Stack>
                                    {isFuture ? <Badge variant="light" color="gray" size="lg">FUTURO</Badge> : <Badge color={cor} variant="filled" size="xl">{c.ader_dia == null ? '-' : `${formatNum(c.ader_dia, 0)}%`}</Badge>}
                                </Group>

                                {/* Shift Breakdown */}
                                {!isFuture && (
                                    <Group gap="xs" mt={-8} mb={4}>
                                        {[1, 2, 3].map(t => {
                                            const d = c.turnos?.[t];
                                            if (!d || d.meta === 0) return null;
                                            // const tCor = d.pct >= 100 ? 'green' : d.pct >= 90 ? 'blue' : d.pct >= 80 ? 'yellow' : 'red';
                                            return (
                                                <Group key={t} gap={4} style={{ opacity: 0.8 }}>
                                                    <Badge variant="outline" size="xs" color="gray">{t}ºT</Badge>
                                                    <Text size="xs" fw={700} c={d.pct >= 100 ? 'green' : d.pct >= 85 ? 'blue' : 'orange'}>
                                                        {formatNum(d.real)}/{formatNum(d.meta)}h
                                                    </Text>
                                                </Group>
                                            )
                                        })}
                                    </Group>
                                )}
                                <Group gap="md" align="center" style={{ flex: 1 }} wrap="nowrap">
                                    <RingProgress size={130} thickness={14} roundCaps sections={[{ value: clamp(c.ader_dia ?? 0), color: perfColor(c.ader_dia) }]} label={<Text ta="center" size="md" fw={900} c={cor}>{c.ader_dia ? `${c.ader_dia.toFixed(0)}%` : '-'}</Text>} />
                                    <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
                                        <Text size="sm" c="dimmed" fw={700} tt="uppercase">Produzido</Text>
                                        <Text fw={900} style={{ fontSize: '2.8rem', lineHeight: 1, color: '#1f2937' }}>{formatNum(c.real_dia)}h</Text>
                                        <Stack gap={0} mt={4}><Text size="sm" c="dimmed">Esperado: <b>{formatNum(c.esperado_dia)}h</b></Text><Text size="sm" c="dimmed">Meta Dia: <b>{formatNum(c.meta_dia)}h</b></Text></Stack>
                                    </Stack>
                                    {c.is_parent && (
                                        <>
                                            <Divider orientation="vertical" mx={2} style={{ height: 100 }} />
                                            <Stack gap={2} style={{ flex: 1, height: 130, overflow: 'hidden' }}>
                                                <Text size="xs" c="dimmed" fw={700}>DETALHE:</Text>
                                                <ScrollArea h="100%" type="never" offsetScrollbars>
                                                    <Stack gap={4}>{c.contribuintes.map((child, idx) => (<Group key={idx} justify="space-between" wrap="nowrap" style={{ borderBottom: '1px solid #f8f9fa', paddingBottom: 2 }}><Text size="xs" fw={600} truncate title={child.codigo} style={{ maxWidth: 90 }}>{child.codigo}</Text><Group gap={4}>{child.is_stale && <IconClock size={12} color="orange" />}<Text size="xs" fw={700}>{child.real.toFixed(1)}</Text></Group></Group>))}</Stack>
                                                </ScrollArea>
                                            </Stack>
                                        </>
                                    )}
                                </Group>
                                <Stack gap="sm" mt="auto">
                                    <Stack gap={2}><Group justify="space-between"><Text size="sm" fw={700} c="dimmed">Progresso vs Esperado</Text><Text size="sm" fw={800}>{clamp(pctEsperado).toFixed(0)}%</Text></Group><Progress size="xl" radius="md" value={clamp(pctEsperado)} color={perfColor(pctEsperado)} striped animated={pctEsperado < 100} /></Stack>
                                    <Stack gap={2}><Group justify="space-between"><Text size="sm" fw={700} c="dimmed">Progresso vs Meta</Text><Text size="sm" fw={800}>{clamp(c.pct_meta_dia ?? 0).toFixed(0)}%</Text></Group><Progress size="xl" radius="md" value={clamp(c.pct_meta_dia ?? 0)} color="blue" /></Stack>
                                </Stack>
                            </Stack>
                        </Card>
                    );
                })}
            </SimpleGrid>
        </Stack>
    );
}
