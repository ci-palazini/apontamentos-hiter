import { Badge, Card, Center, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import {
    ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, Cell, LabelList,
} from 'recharts';
import type { FactoryDayRow } from '../types';
import { perfColor } from '../utils';

function FactoryTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;
    const p = payload.find((x: any) => x.dataKey === 'produzido')?.value ?? 0;
    const m = payload.find((x: any) => x.dataKey === 'meta')?.value ?? 0;
    const diff = p - m;
    const pct = m > 0 ? (p / m) * 100 : 100;
    return (
        <Card shadow="sm" padding="xs" radius="md" withBorder>
            <Text fw={600} mb={4}>{label}</Text>
            <Text size="xs">Produzido: <b>{p.toFixed(2)} h</b></Text>
            <Text size="xs">Meta: <b>{m.toFixed(2)} h</b></Text>
            <Text size="xs">Diferença: <b style={{ color: diff >= 0 ? '#16a34a' : '#ef4444' }}>{diff >= 0 ? '+' : ''}{diff.toFixed(2)} h</b></Text>
            <Text size="xs">Aderência: <b>{pct.toFixed(1)}%</b></Text>
        </Card>
    );
}

function FactoryBarLabel(props: any) {
    const { x, y, width, height, value } = props;
    if (value == null || !height || height < 20) return null;
    return (
        <text x={x + width / 2} y={y - 10} textAnchor="middle" fontSize={16} fontWeight={700} fill="#374151" style={{ pointerEvents: 'none' }}>
            {Number(value).toFixed(1)}
        </text>
    );
}

export function SlideFactory({ dias }: { dias: FactoryDayRow[] }) {
    if (!dias.length) return <Center h="100%"><Text c="dimmed">Sem dados recentes.</Text></Center>;
    return (
        <Stack gap="md" h="100%">
            <Group justify="space-between"><Title order={3}>Produção Diária (Últimos 14 dias)</Title><Group><Badge size="lg" variant="dot" color="orange">Dia Útil</Badge><Badge size="lg" variant="dot" color="blue">Sábado</Badge></Group></Group>
            <div style={{ flex: 1, minHeight: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={dias} margin={{ top: 30, right: 0, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} opacity={0.4} />
                        <XAxis dataKey="label" tick={{ fontSize: 14 }} tickMargin={10} />
                        <YAxis hide /> <ReTooltip content={<FactoryTooltip />} cursor={{ fill: 'rgba(0,0,0,0.05)' }} />
                        <Bar dataKey="produzido" radius={[6, 6, 0, 0]} isAnimationActive={true}>
                            {dias.map((d, i) => <Cell key={i} fill={(d.meta > 0 && d.produzido >= d.meta) ? '#16a34a' : (d.isSaturday ? '#3b82f6' : '#f97316')} />)}
                            <LabelList dataKey="produzido" content={<FactoryBarLabel />} />
                        </Bar>
                        <Line type="monotone" dataKey="metaDisplay" stroke="#1f2937" strokeDasharray="5 5" dot={false} strokeWidth={3} />
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
            <SimpleGrid cols={Math.min(dias.length, 7)} spacing="sm">{dias.slice(-7).map((d) => (<Card key={d.iso} padding="sm" radius="md" withBorder style={{ borderTop: `4px solid var(--mantine-color-${perfColor(d.pct)}-filled)` }}><Stack gap={2} align="center"><Text size="sm" fw={700} c="dimmed">{d.label}</Text><Text size="xl" fw={800}>{d.produzido.toFixed(0)}h</Text><Badge variant="light" size="sm" color={perfColor(d.pct)}>{d.pct.toFixed(0)}%</Badge></Stack></Card>))}</SimpleGrid>
        </Stack>
    );
}
