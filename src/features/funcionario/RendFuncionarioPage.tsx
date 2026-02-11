// src/features/funcionario/RendFuncionarioPage.tsx
import { useEffect, useMemo, useState } from 'react';
import {
    Group, Title, Text, Table, Loader, Badge, rem, Stack,
    Paper, ThemeIcon, SimpleGrid,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useEmpresaId } from '../../contexts/TenantContext';
import {
    fetchFuncionariosMeta,
    fetchFuncionariosDia,
    fetchFuncionariosMes,
    type FuncionarioMeta,
    type FuncionarioDia,
    type FuncionarioMes,
} from '../../services/funcionarios';
import { fetchUltimoDiaComDados } from '../../services/db';
import {
    IconCalendar,
    IconUsers,
    IconTrendingUp,
    IconTarget,
    IconChartBar,
    IconCalendarStats,
} from '@tabler/icons-react';

/* ============================================================
   Helpers
============================================================ */

function toISO(d: Date) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
}

function isoToDate(iso: string) {
    return new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
}

/** Conta dias úteis (seg-sex) do dia 1 até `ateDia` (inclusive) no mesmo mês */
function diasUteisAteDia(ateDia: Date): number {
    const year = ateDia.getFullYear();
    const month = ateDia.getMonth();
    const lastDay = ateDia.getDate();
    let count = 0;
    for (let d = 1; d <= lastDay; d++) {
        const dow = new Date(year, month, d).getDay();
        if (dow >= 1 && dow <= 5) count++;
    }
    return count;
}

/** Primeiro dia do mês no formato ISO */
function primeiroDiaMesISO(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}-01`;
}

function fmtPct(v: number): string {
    return `${v.toFixed(1)}%`;
}

function fmt2(v: number): string {
    return v.toFixed(2);
}

function corAtingimento(pct: number): string {
    if (pct >= 100) return 'teal';
    if (pct >= 80) return 'yellow';
    return 'red';
}

const AREA_COLORS: Record<string, { bg: string; fg: string; gradient: string }> = {
    Montagem: {
        bg: 'rgba(51, 154, 240, 0.08)',
        fg: '#339af0',
        gradient: 'linear-gradient(135deg, rgba(51,154,240,0.12), rgba(51,154,240,0.03))',
    },
    Pintura: {
        bg: 'rgba(190, 75, 219, 0.08)',
        fg: '#be4bdb',
        gradient: 'linear-gradient(135deg, rgba(190,75,219,0.12), rgba(190,75,219,0.03))',
    },
    Usinagem: {
        bg: 'rgba(253, 126, 20, 0.08)',
        fg: '#fd7e14',
        gradient: 'linear-gradient(135deg, rgba(253,126,20,0.12), rgba(253,126,20,0.03))',
    },
    'Sem Área': {
        bg: 'rgba(134, 142, 150, 0.08)',
        fg: '#868e96',
        gradient: 'linear-gradient(135deg, rgba(134,142,150,0.12), rgba(134,142,150,0.03))',
    },
};

function getAreaStyle(area: string) {
    return AREA_COLORS[area] ?? AREA_COLORS['Sem Área'];
}

/* ============================================================
   Tipos derivados
============================================================ */
type RowData = {
    matricula: string;
    nome: string;
    area: string;
    metaDia: number;
    realDia: number;
    deltaDia: number;
    pctDia: number;
    metaAcum: number;
    realAcum: number;
    deltaAcum: number;
    pctMes: number;
};

type GroupData = {
    area: string;
    rows: RowData[];
    totals: Omit<RowData, 'matricula' | 'nome' | 'area'>;
};

/* ============================================================
   Styles
============================================================ */
const glassCard = {
    background: 'linear-gradient(135deg, rgba(255,255,255,0.95), rgba(248,249,250,0.9))',
    backdropFilter: 'blur(12px)',
    border: '1px solid var(--mantine-color-gray-2)',
};

const headerCellStyle = {
    fontSize: rem(11),
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    fontWeight: 700,
    color: 'var(--mantine-color-dimmed)',
    padding: `${rem(10)} ${rem(12)}`,
};

const cellStyle = {
    padding: `${rem(8)} ${rem(12)}`,
    fontSize: rem(13),
};

const rightAlign = { ...cellStyle, textAlign: 'right' as const };

const dividerBorder = '2px solid var(--mantine-color-gray-3)';

/* ============================================================
   Componente principal
============================================================ */
export default function RendimentoPage() {
    const empresaId = useEmpresaId();

    const [dia, setDia] = useState<Date | null>(new Date());
    const [loading, setLoading] = useState(true);

    const [metas, setMetas] = useState<FuncionarioMeta[]>([]);
    const [dadosDia, setDadosDia] = useState<FuncionarioDia[]>([]);
    const [dadosMes, setDadosMes] = useState<FuncionarioMes[]>([]);

    /* ---- Carga inicial: detectar último dia com dados ---- */
    useEffect(() => {
        (async () => {
            try {
                const lastISO = await fetchUltimoDiaComDados(empresaId);
                if (lastISO) setDia(isoToDate(lastISO));
            } catch { /* mantém hoje */ }
        })();
    }, [empresaId]);

    /* ---- Carrega dados sempre que dia muda ---- */
    useEffect(() => {
        if (!dia) return;
        let cancelled = false;

        (async () => {
            setLoading(true);
            try {
                const diaISO = toISO(dia);
                const mesISO = primeiroDiaMesISO(dia);

                const [metasRes, diaRes, mesRes] = await Promise.all([
                    fetchFuncionariosMeta(empresaId),
                    fetchFuncionariosDia(empresaId, diaISO),
                    fetchFuncionariosMes(empresaId, mesISO),
                ]);

                if (!cancelled) {
                    setMetas(metasRes);
                    setDadosDia(diaRes);
                    setDadosMes(mesRes);
                }
            } catch (e) {
                console.error('Erro ao carregar monitoramento:', e);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [empresaId, dia?.getTime()]);

    /* ---- Calcular dados agrupados ---- */
    const groups: GroupData[] = useMemo(() => {
        if (!dia || metas.length === 0) return [];

        const diasUteis = diasUteisAteDia(dia);

        const prodDiaMap = new Map<string, number>();
        for (const d of dadosDia) {
            prodDiaMap.set(d.matricula, (prodDiaMap.get(d.matricula) ?? 0) + Number(d.produzido_h));
        }

        const prodMesMap = new Map<string, number>();
        for (const m of dadosMes) {
            prodMesMap.set(m.matricula, (prodMesMap.get(m.matricula) ?? 0) + Number(m.produzido_h));
        }

        const activeMetas = metas.filter(m => m.ativo);
        const rows: RowData[] = activeMetas.map(m => {
            const metaDia = m.meta_diaria_horas;
            const realDia = prodDiaMap.get(m.matricula) ?? 0;
            const deltaDia = realDia - metaDia;
            const pctDia = metaDia > 0 ? (realDia / metaDia) * 100 : 0;

            const metaAcum = metaDia * diasUteis;
            const realAcum = prodMesMap.get(m.matricula) ?? 0;
            const deltaAcum = realAcum - metaAcum;
            const pctMes = metaAcum > 0 ? (realAcum / metaAcum) * 100 : 0;

            return {
                matricula: m.matricula,
                nome: m.nome,
                area: m.area ?? 'Sem Área',
                metaDia,
                realDia: +realDia.toFixed(2),
                deltaDia: +deltaDia.toFixed(2),
                pctDia: +pctDia.toFixed(1),
                metaAcum: +metaAcum.toFixed(2),
                realAcum: +realAcum.toFixed(2),
                deltaAcum: +deltaAcum.toFixed(2),
                pctMes: +pctMes.toFixed(1),
            };
        });

        const areaOrder = ['Montagem', 'Pintura', 'Usinagem', 'Sem Área'];
        const areaMap = new Map<string, RowData[]>();
        for (const r of rows) {
            const arr = areaMap.get(r.area) ?? [];
            arr.push(r);
            areaMap.set(r.area, arr);
        }

        const result: GroupData[] = [];
        for (const area of areaOrder) {
            const areaRows = areaMap.get(area);
            if (!areaRows || areaRows.length === 0) continue;

            areaRows.sort((a, b) => a.matricula.localeCompare(b.matricula, 'pt-BR', { numeric: true }));

            const totalMetaDia = areaRows.reduce((s, r) => s + r.metaDia, 0);
            const totalRealDia = areaRows.reduce((s, r) => s + r.realDia, 0);
            const totalMetaAcum = areaRows.reduce((s, r) => s + r.metaAcum, 0);
            const totalRealAcum = areaRows.reduce((s, r) => s + r.realAcum, 0);

            result.push({
                area,
                rows: areaRows,
                totals: {
                    metaDia: +totalMetaDia.toFixed(2),
                    realDia: +totalRealDia.toFixed(2),
                    deltaDia: +(totalRealDia - totalMetaDia).toFixed(2),
                    pctDia: totalMetaDia > 0 ? +((totalRealDia / totalMetaDia) * 100).toFixed(1) : 0,
                    metaAcum: +totalMetaAcum.toFixed(2),
                    realAcum: +totalRealAcum.toFixed(2),
                    deltaAcum: +(totalRealAcum - totalMetaAcum).toFixed(2),
                    pctMes: totalMetaAcum > 0 ? +((totalRealAcum / totalMetaAcum) * 100).toFixed(1) : 0,
                },
            });
        }

        return result;
    }, [metas, dadosDia, dadosMes, dia]);

    /* ---- Grand total ---- */
    const grandTotal = useMemo(() => {
        if (groups.length === 0) return null;
        const allRows = groups.flatMap(g => g.rows);
        const metaDia = allRows.reduce((s, r) => s + r.metaDia, 0);
        const realDia = allRows.reduce((s, r) => s + r.realDia, 0);
        const metaAcum = allRows.reduce((s, r) => s + r.metaAcum, 0);
        const realAcum = allRows.reduce((s, r) => s + r.realAcum, 0);
        return {
            metaDia: +metaDia.toFixed(2),
            realDia: +realDia.toFixed(2),
            deltaDia: +(realDia - metaDia).toFixed(2),
            pctDia: metaDia > 0 ? +((realDia / metaDia) * 100).toFixed(1) : 0,
            metaAcum: +metaAcum.toFixed(2),
            realAcum: +realAcum.toFixed(2),
            deltaAcum: +(realAcum - metaAcum).toFixed(2),
            pctMes: metaAcum > 0 ? +((realAcum / metaAcum) * 100).toFixed(1) : 0,
            totalFuncs: allRows.length,
        };
    }, [groups]);

    /* ============================================================
       Render
    ============================================================ */
    const diasUteis = dia ? diasUteisAteDia(dia) : 0;

    /** Helper: renders a delta value with color and sign */
    const DeltaCell = ({ value, style }: { value: number; style?: React.CSSProperties }) => (
        <Text
            size="sm" fw={600}
            style={{
                color: value >= 0 ? 'var(--mantine-color-teal-6)' : 'var(--mantine-color-red-6)',
                fontVariantNumeric: 'tabular-nums',
                ...style,
            }}
        >
            {value >= 0 ? '+' : ''}{fmt2(value)}
        </Text>
    );

    /** Helper: renders a % badge with conditional color */
    const PctBadge = ({ value, filled }: { value: number; filled?: boolean }) => (
        <Badge
            variant={filled ? 'filled' : 'light'}
            color={corAtingimento(value)}
            size="sm"
            style={{
                fontVariantNumeric: 'tabular-nums',
                fontWeight: 700,
                minWidth: rem(58),
                textAlign: 'center',
            }}
        >
            {fmtPct(value)}
        </Badge>
    );

    return (
        <Stack gap="lg">
            {/* ========== Header ========== */}
            <Group justify="space-between" align="flex-start">
                <Group gap="sm">
                    <ThemeIcon size={40} radius="xl" variant="gradient" gradient={{ from: 'blue', to: 'cyan', deg: 135 }}>
                        <IconUsers size={22} />
                    </ThemeIcon>
                    <div>
                        <Title order={2} style={{ lineHeight: 1.2 }}>Monitoramento Diário</Title>
                        <Text size="sm" c="dimmed">Rendimento individual por funcionário</Text>
                    </div>
                </Group>
            </Group>

            {/* ========== KPI Cards + Date Filter ========== */}
            <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="md">
                {/* Date Picker Card */}
                <Paper
                    shadow="xs" radius="lg" p="md"
                    style={{ ...glassCard }}
                >
                    <Stack gap="xs">
                        <Group gap={6}>
                            <IconCalendar size={16} color="var(--mantine-color-dimmed)" />
                            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.5px' }}>Data</Text>
                        </Group>
                        <DatePickerInput
                            value={dia ?? undefined}
                            onChange={(v: any) => {
                                if (v instanceof Date) setDia(v);
                                else if (typeof v === 'string') {
                                    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
                                    if (m) setDia(new Date(+m[1], +m[2] - 1, +m[3]));
                                }
                            }}
                            valueFormat="DD/MM/YYYY"
                            locale="pt-BR"
                            size="sm"
                            styles={{
                                input: { fontWeight: 600, fontSize: rem(14), background: 'transparent', border: '1px solid var(--mantine-color-gray-3)' },
                            }}
                        />
                    </Stack>
                </Paper>

                {/* Dias Úteis */}
                <Paper shadow="xs" radius="lg" p="md" style={{ ...glassCard }}>
                    <Stack gap={4}>
                        <Group gap={6}>
                            <IconCalendarStats size={16} color="var(--mantine-color-dimmed)" />
                            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.5px' }}>Dias Úteis no Mês</Text>
                        </Group>
                        <Text fw={800} size="xl" style={{ fontVariantNumeric: 'tabular-nums' }}>{diasUteis}</Text>
                        <Text size="xs" c="dimmed">seg-sex até a data</Text>
                    </Stack>
                </Paper>

                {/* Total Funcionários */}
                <Paper shadow="xs" radius="lg" p="md" style={{ ...glassCard }}>
                    <Stack gap={4}>
                        <Group gap={6}>
                            <IconUsers size={16} color="var(--mantine-color-dimmed)" />
                            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.5px' }}>Funcionários</Text>
                        </Group>
                        <Text fw={800} size="xl" style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {grandTotal?.totalFuncs ?? 0}
                        </Text>
                        <Text size="xs" c="dimmed">ativos com meta</Text>
                    </Stack>
                </Paper>

                {/* % Geral Mês */}
                <Paper shadow="xs" radius="lg" p="md" style={{ ...glassCard }}>
                    <Stack gap={4}>
                        <Group gap={6}>
                            <IconTarget size={16} color="var(--mantine-color-dimmed)" />
                            <Text size="xs" fw={600} tt="uppercase" c="dimmed" style={{ letterSpacing: '0.5px' }}>Atingimento Mês</Text>
                        </Group>
                        <Group gap="xs" align="baseline">
                            <Text
                                fw={800} size="xl"
                                c={grandTotal ? corAtingimento(grandTotal.pctMes) : 'dimmed'}
                                style={{ fontVariantNumeric: 'tabular-nums' }}
                            >
                                {grandTotal ? fmtPct(grandTotal.pctMes) : '—'}
                            </Text>
                        </Group>
                        <Text size="xs" c="dimmed">acumulado geral</Text>
                    </Stack>
                </Paper>
            </SimpleGrid>

            {/* ========== Tabela ========== */}
            {loading ? (
                <Group justify="center" mt="xl"><Loader size="lg" /></Group>
            ) : groups.length === 0 ? (
                <Paper shadow="xs" radius="lg" p="xl" ta="center" style={{ ...glassCard }}>
                    <IconChartBar size={48} color="var(--mantine-color-dimmed)" style={{ opacity: 0.4 }} />
                    <Text c="dimmed" size="lg" mt="sm">Nenhum funcionário cadastrado ou sem dados para esta data.</Text>
                    <Text c="dimmed" size="sm" mt={4}>Configure funcionários em Configurações → Funcionários.</Text>
                </Paper>
            ) : (
                <Paper shadow="sm" radius="lg" style={{ ...glassCard, overflow: 'hidden' }}>
                    <div style={{ overflowX: 'auto' }}>
                        <Table
                            highlightOnHover
                            withColumnBorders
                            style={{ minWidth: rem(1100) }}
                            styles={{
                                table: { borderCollapse: 'collapse' },
                                tr: { transition: 'background 0.15s ease' },
                            }}
                        >
                            {/* ===== Header ===== */}
                            <Table.Thead>
                                {/* Super-header */}
                                <Table.Tr style={{ background: 'var(--mantine-color-gray-0)' }}>
                                    <Table.Th
                                        colSpan={3}
                                        style={{ ...headerCellStyle, textAlign: 'center', borderRight: dividerBorder, borderBottom: 'none' }}
                                    >
                                        Identificação
                                    </Table.Th>
                                    <Table.Th
                                        colSpan={4}
                                        style={{ ...headerCellStyle, textAlign: 'center', borderRight: dividerBorder, borderBottom: 'none' }}
                                    >
                                        Desempenho do Dia
                                    </Table.Th>
                                    <Table.Th
                                        colSpan={4}
                                        style={{ ...headerCellStyle, textAlign: 'center', borderBottom: 'none' }}
                                    >
                                        Acumulado no Mês
                                    </Table.Th>
                                </Table.Tr>
                                {/* Sub-header */}
                                <Table.Tr style={{ background: 'var(--mantine-color-gray-0)' }}>
                                    <Table.Th style={{ ...headerCellStyle, minWidth: rem(75) }}>Matrícula</Table.Th>
                                    <Table.Th style={{ ...headerCellStyle, minWidth: rem(130) }}>Nome</Table.Th>
                                    <Table.Th style={{ ...headerCellStyle, minWidth: rem(90), borderRight: dividerBorder }}>Área</Table.Th>
                                    <Table.Th style={{ ...headerCellStyle, textAlign: 'right', minWidth: rem(68) }}>Meta</Table.Th>
                                    <Table.Th style={{ ...headerCellStyle, textAlign: 'right', minWidth: rem(68) }}>Real</Table.Th>
                                    <Table.Th style={{ ...headerCellStyle, textAlign: 'right', minWidth: rem(68) }}>Delta</Table.Th>
                                    <Table.Th style={{ ...headerCellStyle, textAlign: 'right', minWidth: rem(60), borderRight: dividerBorder }}>%</Table.Th>
                                    <Table.Th style={{ ...headerCellStyle, textAlign: 'right', minWidth: rem(78) }}>Meta</Table.Th>
                                    <Table.Th style={{ ...headerCellStyle, textAlign: 'right', minWidth: rem(78) }}>Real</Table.Th>
                                    <Table.Th style={{ ...headerCellStyle, textAlign: 'right', minWidth: rem(78) }}>Delta</Table.Th>
                                    <Table.Th style={{ ...headerCellStyle, textAlign: 'right', minWidth: rem(60) }}>%</Table.Th>
                                </Table.Tr>
                            </Table.Thead>

                            <Table.Tbody>
                                {groups.map(g => {
                                    const areaStyle = getAreaStyle(g.area);
                                    return (
                                        <>
                                            {/* Area group header */}
                                            <Table.Tr key={`header-${g.area}`} style={{ background: areaStyle.bg }}>
                                                <Table.Td colSpan={11} style={{ padding: `${rem(6)} ${rem(12)}` }}>
                                                    <Group gap="xs">
                                                        <div
                                                            style={{
                                                                width: 4,
                                                                height: 18,
                                                                borderRadius: 2,
                                                                backgroundColor: areaStyle.fg,
                                                            }}
                                                        />
                                                        <Text fw={700} size="xs" tt="uppercase" style={{ letterSpacing: '1px', color: areaStyle.fg }}>
                                                            {g.area}
                                                        </Text>
                                                        <Badge variant="light" size="xs" color="gray">{g.rows.length} func.</Badge>
                                                    </Group>
                                                </Table.Td>
                                            </Table.Tr>

                                            {/* Data rows */}
                                            {g.rows.map((r, idx) => (
                                                <Table.Tr
                                                    key={r.matricula}
                                                    style={{
                                                        borderLeft: `3px solid ${areaStyle.fg}`,
                                                        background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.015)',
                                                    }}
                                                >
                                                    <Table.Td style={cellStyle}>
                                                        <Text ff="monospace" fw={700} size="sm" style={{ color: areaStyle.fg }}>
                                                            {r.matricula}
                                                        </Text>
                                                    </Table.Td>
                                                    <Table.Td style={cellStyle}>
                                                        <Text size="sm" fw={500}>{r.nome}</Text>
                                                    </Table.Td>
                                                    <Table.Td style={{ ...cellStyle, borderRight: dividerBorder }}>
                                                        <Badge
                                                            variant="dot"
                                                            size="sm"
                                                            color={areaStyle.fg}
                                                            styles={{ root: { color: areaStyle.fg } }}
                                                        >
                                                            {r.area}
                                                        </Badge>
                                                    </Table.Td>

                                                    {/* Dia */}
                                                    <Table.Td style={rightAlign}>
                                                        <Text size="sm" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(r.metaDia)}</Text>
                                                    </Table.Td>
                                                    <Table.Td style={rightAlign}>
                                                        <Text size="sm" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(r.realDia)}</Text>
                                                    </Table.Td>
                                                    <Table.Td style={rightAlign}>
                                                        <DeltaCell value={r.deltaDia} />
                                                    </Table.Td>
                                                    <Table.Td style={{ ...rightAlign, borderRight: dividerBorder }}>
                                                        <PctBadge value={r.pctDia} />
                                                    </Table.Td>

                                                    {/* Acumulado */}
                                                    <Table.Td style={rightAlign}>
                                                        <Text size="sm" c="dimmed" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(r.metaAcum)}</Text>
                                                    </Table.Td>
                                                    <Table.Td style={rightAlign}>
                                                        <Text size="sm" fw={700} style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(r.realAcum)}</Text>
                                                    </Table.Td>
                                                    <Table.Td style={rightAlign}>
                                                        <DeltaCell value={r.deltaAcum} />
                                                    </Table.Td>
                                                    <Table.Td style={rightAlign}>
                                                        <PctBadge value={r.pctMes} />
                                                    </Table.Td>
                                                </Table.Tr>
                                            ))}

                                            {/* Subtotal */}
                                            <Table.Tr
                                                key={`subtotal-${g.area}`}
                                                style={{
                                                    background: areaStyle.gradient,
                                                    borderLeft: `3px solid ${areaStyle.fg}`,
                                                    borderBottom: `2px solid ${areaStyle.fg}33`,
                                                }}
                                            >
                                                <Table.Td colSpan={3} style={{ ...cellStyle, borderRight: dividerBorder }}>
                                                    <Group gap="xs">
                                                        <Badge variant="filled" size="sm" style={{ backgroundColor: areaStyle.fg }}>
                                                            Σ {g.area}
                                                        </Badge>
                                                        <Text fw={800} size="xs" c="dimmed">
                                                            {g.rows.length} funcionário{g.rows.length > 1 ? 's' : ''}
                                                        </Text>
                                                    </Group>
                                                </Table.Td>
                                                <Table.Td style={rightAlign}>
                                                    <Text fw={800} size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(g.totals.metaDia)}</Text>
                                                </Table.Td>
                                                <Table.Td style={rightAlign}>
                                                    <Text fw={800} size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(g.totals.realDia)}</Text>
                                                </Table.Td>
                                                <Table.Td style={rightAlign}>
                                                    <DeltaCell value={g.totals.deltaDia} style={{ fontWeight: 800 }} />
                                                </Table.Td>
                                                <Table.Td style={{ ...rightAlign, borderRight: dividerBorder }}>
                                                    <PctBadge value={g.totals.pctDia} filled />
                                                </Table.Td>
                                                <Table.Td style={rightAlign}>
                                                    <Text fw={800} size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(g.totals.metaAcum)}</Text>
                                                </Table.Td>
                                                <Table.Td style={rightAlign}>
                                                    <Text fw={800} size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(g.totals.realAcum)}</Text>
                                                </Table.Td>
                                                <Table.Td style={rightAlign}>
                                                    <DeltaCell value={g.totals.deltaAcum} style={{ fontWeight: 800 }} />
                                                </Table.Td>
                                                <Table.Td style={rightAlign}>
                                                    <PctBadge value={g.totals.pctMes} filled />
                                                </Table.Td>
                                            </Table.Tr>
                                        </>
                                    );
                                })}

                                {/* ===== Grand Total ===== */}
                                {grandTotal && (
                                    <Table.Tr style={{
                                        background: 'linear-gradient(135deg, var(--mantine-color-gray-1), var(--mantine-color-gray-0))',
                                        borderTop: '3px solid var(--mantine-primary-color-filled)',
                                    }}>
                                        <Table.Td colSpan={3} style={{ ...cellStyle, borderRight: dividerBorder }}>
                                            <Group gap="xs">
                                                <ThemeIcon size={22} radius="xl" variant="gradient" gradient={{ from: 'blue', to: 'cyan' }}>
                                                    <IconTrendingUp size={14} />
                                                </ThemeIcon>
                                                <Text fw={900} size="sm" tt="uppercase" style={{ letterSpacing: '0.5px' }}>
                                                    Total Geral
                                                </Text>
                                                <Badge variant="light" size="xs">{grandTotal.totalFuncs} func.</Badge>
                                            </Group>
                                        </Table.Td>
                                        <Table.Td style={rightAlign}>
                                            <Text fw={900} size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(grandTotal.metaDia)}</Text>
                                        </Table.Td>
                                        <Table.Td style={rightAlign}>
                                            <Text fw={900} size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(grandTotal.realDia)}</Text>
                                        </Table.Td>
                                        <Table.Td style={rightAlign}>
                                            <DeltaCell value={grandTotal.deltaDia} style={{ fontWeight: 900 }} />
                                        </Table.Td>
                                        <Table.Td style={{ ...rightAlign, borderRight: dividerBorder }}>
                                            <PctBadge value={grandTotal.pctDia} filled />
                                        </Table.Td>
                                        <Table.Td style={rightAlign}>
                                            <Text fw={900} size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(grandTotal.metaAcum)}</Text>
                                        </Table.Td>
                                        <Table.Td style={rightAlign}>
                                            <Text fw={900} size="sm" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt2(grandTotal.realAcum)}</Text>
                                        </Table.Td>
                                        <Table.Td style={rightAlign}>
                                            <DeltaCell value={grandTotal.deltaAcum} style={{ fontWeight: 900 }} />
                                        </Table.Td>
                                        <Table.Td style={rightAlign}>
                                            <PctBadge value={grandTotal.pctMes} filled />
                                        </Table.Td>
                                    </Table.Tr>
                                )}
                            </Table.Tbody>
                        </Table>
                    </div>

                    {/* Legenda */}
                    <Group p="md" gap="xl" style={{ borderTop: '1px solid var(--mantine-color-gray-2)' }}>
                        <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.5px' }}>Legenda:</Text>
                        <Group gap="lg">
                            <Group gap={6}>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--mantine-color-teal-6)' }} />
                                <Text size="xs" c="dimmed">≥ 100%</Text>
                            </Group>
                            <Group gap={6}>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--mantine-color-yellow-6)' }} />
                                <Text size="xs" c="dimmed">80 – 99%</Text>
                            </Group>
                            <Group gap={6}>
                                <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: 'var(--mantine-color-red-6)' }} />
                                <Text size="xs" c="dimmed">&lt; 80%</Text>
                            </Group>
                        </Group>
                    </Group>
                </Paper>
            )}
        </Stack>
    );
}
