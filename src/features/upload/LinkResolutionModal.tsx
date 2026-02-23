// src/features/upload/LinkResolutionModal.tsx
import {
  Modal, Button, Text, TextInput, Group, Badge, ScrollArea,
  SegmentedControl, Card, Stack, Alert, MultiSelect, Tabs,
} from '@mantine/core';
import { useState, useEffect, useMemo } from 'react';
import { IconAlertCircle } from '@tabler/icons-react';

/* ============================================================
   Tipos públicos
   ============================================================ */

/**
 * Matrícula que precisa ação manual:
 * - mustCreateUser = true  → não existe no banco; precisa de nome/turno + seleção de máquinas
 * - mustCreateUser = false → existe, mas sem vínculo de máquinas ativo para este dia
 */
export type MatriculaPendente = {
  matricula: string;
  nome: string;              // '' se usuário novo
  data_wip: string;
  totalHoras: number;
  mustCreateUser: boolean;
  availableCentros: { id: number; codigo: string }[];
};

/** Matrícula com múltiplas máquinas vinculadas → operador distribui as horas */
export type MatriculaDistribuir = {
  matricula: string;
  nome: string;
  data_wip: string;
  totalHoras: number;
  machineIds: number[];
  machineCodes: string[];
};

export type ConfirmedPendente = {
  matricula: string;
  nome: string;
  data_wip: string;
  turno: number;
  isNewUser: boolean;
  centroHoras: { centroId: number; horas: number }[];
};

export type ConfirmedDistribuicao = {
  matricula: string;
  data_wip: string;
  centroHoras: { centroId: number; horas: number }[];
};

/* ============================================================
   Helpers internos
   ============================================================ */
function itemKey(matricula: string, data_wip: string) {
  return `${matricula}|${data_wip}`;
}
function formatDataBR(iso: string) {
  if (!iso || iso.length < 10) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function sumInputs(rec: Record<number, string>): number {
  return Object.values(rec).reduce((s, v) => s + (parseFloat(v) || 0), 0);
}

/* ============================================================
   Props
   ============================================================ */
interface LinkResolutionModalProps {
  opened: boolean;
  onClose: () => void;
  onConfirm: (pendentes: ConfirmedPendente[], distribuicoes: ConfirmedDistribuicao[]) => void;
  pendentes: MatriculaPendente[];
  paraDistribuir: MatriculaDistribuir[];
}

/* ============================================================
   Componente
   ============================================================ */
export default function LinkResolutionModal({
  opened, onClose, onConfirm, pendentes, paraDistribuir,
}: LinkResolutionModalProps) {

  /* --- Estado pendentes (novos / sem vínculo) --- */
  const [nomes, setNomes] = useState<Record<string, string>>({});
  const [turnos, setTurnos] = useState<Record<string, number>>({});
  const [selectedCentros, setSelectedCentros] = useState<Record<string, number[]>>({});
  const [horasPendentes, setHorasPendentes] = useState<Record<string, Record<number, string>>>({});

  /* --- Estado distribuição (múltiplas máquinas) --- */
  const [horasDistribuir, setHorasDistribuir] = useState<Record<string, Record<number, string>>>({});

  /* Reset ao (re)abrir o modal */
  useEffect(() => {
    if (!opened) return;
    const ns: Record<string, string> = {};
    const ts: Record<string, number> = {};
    pendentes.forEach(p => {
      const k = itemKey(p.matricula, p.data_wip);
      ns[k] = p.nome;
      ts[k] = 1;
    });
    setNomes(ns);
    setTurnos(ts);
    setSelectedCentros({});
    setHorasPendentes({});

    const hd: Record<string, Record<number, string>> = {};
    paraDistribuir.forEach(d => {
      const k = itemKey(d.matricula, d.data_wip);
      const eq = (d.totalHoras / d.machineIds.length).toFixed(2);
      const sub: Record<number, string> = {};
      d.machineIds.forEach(id => { sub[id] = eq; });
      hd[k] = sub;
    });
    setHorasDistribuir(hd);
  }, [opened]);

  /* --- Validação em tempo real --- */
  const errors = useMemo(() => {
    const errs: Record<string, string> = {};

    pendentes.forEach(p => {
      const k = itemKey(p.matricula, p.data_wip);
      const sIds = selectedCentros[k] ?? [];
      if (sIds.length === 0) { errs[k] = 'Selecione ao menos uma máquina.'; return; }
      if (p.mustCreateUser && !(nomes[k] ?? '').trim()) { errs[k] = 'Nome obrigatório.'; return; }
      if (sIds.length > 1) {
        const diff = Math.abs(sumInputs(horasPendentes[k] ?? {}) - p.totalHoras);
        if (diff > 0.02) errs[k] = `Soma deve ser ${p.totalHoras.toFixed(2)} h · atual: ${sumInputs(horasPendentes[k] ?? {}).toFixed(2)} h`;
      }
    });

    paraDistribuir.forEach(d => {
      const k = itemKey(d.matricula, d.data_wip);
      const diff = Math.abs(sumInputs(horasDistribuir[k] ?? {}) - d.totalHoras);
      if (diff > 0.02) errs[k] = `Soma deve ser ${d.totalHoras.toFixed(2)} h · atual: ${sumInputs(horasDistribuir[k] ?? {}).toFixed(2)} h`;
    });

    return errs;
  }, [nomes, selectedCentros, horasPendentes, horasDistribuir, pendentes, paraDistribuir]);

  const hasErrors = Object.keys(errors).length > 0;

  /* --- Confirm --- */
  const handleConfirm = () => {
    const confirmedPendentes: ConfirmedPendente[] = pendentes.map(p => {
      const k = itemKey(p.matricula, p.data_wip);
      const sIds = selectedCentros[k] ?? [];
      const sub = horasPendentes[k] ?? {};
      const centroHoras =
        sIds.length === 1
          ? [{ centroId: sIds[0], horas: p.totalHoras }]
          : sIds.map(id => ({ centroId: id, horas: parseFloat(sub[id] ?? '0') || 0 }));
      return {
        matricula: p.matricula,
        nome: (nomes[k] ?? '').trim() || `Func ${p.matricula}`,
        data_wip: p.data_wip,
        turno: turnos[k] ?? 1,
        isNewUser: p.mustCreateUser,
        centroHoras,
      };
    });

    const confirmedDistribuicoes: ConfirmedDistribuicao[] = paraDistribuir.map(d => {
      const k = itemKey(d.matricula, d.data_wip);
      const sub = horasDistribuir[k] ?? {};
      return {
        matricula: d.matricula,
        data_wip: d.data_wip,
        centroHoras: d.machineIds.map(id => ({ centroId: id, horas: parseFloat(sub[id] ?? '0') || 0 })),
      };
    });

    onConfirm(confirmedPendentes, confirmedDistribuicoes);
  };

  /* --- Helpers de estado seleção --- */
  const handleSelectCentros = (p: MatriculaPendente, vals: string[]) => {
    const k = itemKey(p.matricula, p.data_wip);
    const ids = vals.map(Number);
    setSelectedCentros(prev => ({ ...prev, [k]: ids }));
    const sub: Record<number, string> = {};
    if (ids.length === 1) sub[ids[0]] = p.totalHoras.toFixed(2);
    else ids.forEach(id => { sub[id] = (p.totalHoras / ids.length).toFixed(2); });
    setHorasPendentes(prev => ({ ...prev, [k]: sub }));
  };

  const total = pendentes.length + paraDistribuir.length;
  const defaultTab = pendentes.length > 0 ? 'pendentes' : 'distribuir';

  /* ============================================================
     Render
     ============================================================ */
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={`Resolver Pendências de Upload (${total} matrícula${total !== 1 ? 's' : ''})`}
      size="xl"
    >
      {/* Resumo rápido no topo */}
      <Group gap="xs" mb="sm" wrap="nowrap">
        {pendentes.length > 0 && (
          <Badge
            color={pendentes.some(p => p.mustCreateUser) ? 'red' : 'orange'}
            variant="filled"
            size="lg"
          >
            {pendentes.length} para cadastrar/vincular
          </Badge>
        )}
        {paraDistribuir.length > 0 && (
          <Badge color="blue" variant="filled" size="lg">
            {paraDistribuir.length} para distribuir horas
          </Badge>
        )}
      </Group>

      <Tabs defaultValue={defaultTab}>
        <Tabs.List mb="md">
          {pendentes.length > 0 && (
            <Tabs.Tab
              value="pendentes"
              color={pendentes.some(p => p.mustCreateUser) ? 'red' : 'orange'}
              rightSection={
                <Badge size="xs" color={pendentes.some(p => p.mustCreateUser) ? 'red' : 'orange'} variant="filled" circle>
                  {pendentes.length}
                </Badge>
              }
            >
              Cadastrar / Vincular
            </Tabs.Tab>
          )}
          {paraDistribuir.length > 0 && (
            <Tabs.Tab
              value="distribuir"
              color="blue"
              rightSection={
                <Badge size="xs" color="blue" variant="filled" circle>
                  {paraDistribuir.length}
                </Badge>
              }
            >
              Distribuir Horas
            </Tabs.Tab>
          )}
        </Tabs.List>

        {/* ---- Aba A+B: Pendentes ---- */}
        {pendentes.length > 0 && (
          <Tabs.Panel value="pendentes">
            <ScrollArea.Autosize mah="60vh" px="xs">
              <Text size="sm" c="dimmed" mb="md">
                Selecione a(s) máquina(s). Com mais de uma, distribua as horas manualmente.
              </Text>
              <Stack gap="sm" mb="lg">
                {pendentes.map(p => {
                  const k = itemKey(p.matricula, p.data_wip);
                  const sIds = selectedCentros[k] ?? [];
                  const sub = horasPendentes[k] ?? {};
                  const restante = p.totalHoras - sumInputs(sub);
                  const err = errors[k];

                  return (
                    <Card key={k} withBorder p="md" radius="md">
                      <Group justify="space-between" mb="xs" wrap="nowrap">
                        <Group gap="xs">
                          <Badge color={p.mustCreateUser ? 'red' : 'orange'} variant="light" size="lg">
                            {p.matricula}
                          </Badge>
                          {p.mustCreateUser && <Badge color="red" size="xs">NOVO</Badge>}
                          {p.nome && <Text size="sm">{p.nome}</Text>}
                          <Text size="sm" c="dimmed">{formatDataBR(p.data_wip)}</Text>
                        </Group>
                        <Badge variant="dot" color="blue" style={{ whiteSpace: 'nowrap' }}>
                          {p.totalHoras.toFixed(2)} h
                        </Badge>
                      </Group>

                      {p.mustCreateUser && (
                        <Group mb="sm" align="flex-end" grow>
                          <TextInput
                            label="Nome"
                            placeholder="Nome completo"
                            value={nomes[k] ?? ''}
                            onChange={e => { const val = e.currentTarget.value; setNomes(prev => ({ ...prev, [k]: val })); }}
                            size="sm"
                            required
                          />
                          <div>
                            <Text size="sm" fw={500} mb={4}>Turno</Text>
                            <SegmentedControl
                              value={String(turnos[k] ?? 1)}
                              onChange={v => setTurnos(prev => ({ ...prev, [k]: Number(v) }))}
                              data={[
                                { label: '1º T', value: '1' },
                                { label: '2º T', value: '2' },
                                { label: '3º T', value: '3' },
                              ]}
                              size="sm"
                            />
                          </div>
                        </Group>
                      )}

                      <MultiSelect
                        label="Máquinas a vincular"
                        placeholder="Digite para filtrar..."
                        data={p.availableCentros.map(c => ({ value: String(c.id), label: c.codigo }))}
                        value={sIds.map(String)}
                        onChange={vals => handleSelectCentros(p, vals)}
                        searchable
                        clearable
                        mb="sm"
                        size="sm"
                      />

                      {sIds.length > 1 && (
                        <div>
                          <Text size="xs" c="dimmed" mb={6}>Distribuição das horas:</Text>
                          <Group gap="xs" wrap="wrap" mb={6}>
                            {sIds.map(id => {
                              const code = p.availableCentros.find(c => c.id === id)?.codigo ?? `ID${id}`;
                              return (
                                <div key={id} style={{ flex: '1 1 110px', minWidth: 90 }}>
                                  <TextInput
                                    label={code}
                                    value={sub[id] ?? ''}
                                    onChange={e => {
                                      const val = e.currentTarget.value;
                                      setHorasPendentes(prev => ({
                                        ...prev, [k]: { ...(prev[k] ?? {}), [id]: val },
                                      }));
                                    }}
                                    size="xs" type="number" step="0.01" min="0"
                                    rightSection={<Text size="xs" c="dimmed">h</Text>}
                                  />
                                </div>
                              );
                            })}
                          </Group>
                          <Text size="xs" c={Math.abs(restante) > 0.02 ? 'red' : 'green'}>
                            Restante: {restante.toFixed(2)} h{Math.abs(restante) <= 0.02 ? ' ✓' : ''}
                          </Text>
                        </div>
                      )}

                      {err && (
                        <Alert color="red" mt="xs" p="xs" icon={<IconAlertCircle size={14} />}>{err}</Alert>
                      )}
                    </Card>
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
          </Tabs.Panel>
        )}

        {/* ---- Aba C: Distribuição de horas ---- */}
        {paraDistribuir.length > 0 && (
          <Tabs.Panel value="distribuir">
            <ScrollArea.Autosize mah="60vh" px="xs">
              <Text size="sm" c="dimmed" mb="md">
                Essas matrículas têm mais de uma máquina vinculada. Defina quanto vai para cada uma.
              </Text>
              <Stack gap="sm" mb="lg">
                {paraDistribuir.map(d => {
                  const k = itemKey(d.matricula, d.data_wip);
                  const sub = horasDistribuir[k] ?? {};
                  const restante = d.totalHoras - sumInputs(sub);
                  const err = errors[k];

                  return (
                    <Card key={k} withBorder p="md" radius="md">
                      <Group justify="space-between" mb="sm" wrap="nowrap">
                        <Group gap="xs">
                          <Badge color="blue" variant="light" size="lg">{d.matricula}</Badge>
                          {d.nome && <Text size="sm">{d.nome}</Text>}
                          <Text size="sm" c="dimmed">{formatDataBR(d.data_wip)}</Text>
                        </Group>
                        <Badge variant="dot" color="blue" style={{ whiteSpace: 'nowrap' }}>
                          {d.totalHoras.toFixed(2)} h total
                        </Badge>
                      </Group>

                      <Group gap="xs" wrap="wrap" mb={6}>
                        {d.machineIds.map((id, i) => (
                          <div key={id} style={{ flex: '1 1 110px', minWidth: 90 }}>
                            <TextInput
                              label={d.machineCodes[i]}
                              value={sub[id] ?? ''}
                              onChange={e => {
                                const val = e.currentTarget.value;
                                setHorasDistribuir(prev => ({
                                  ...prev, [k]: { ...(prev[k] ?? {}), [id]: val },
                                }));
                              }}
                              size="sm" type="number" step="0.01" min="0"
                              rightSection={<Text size="xs" c="dimmed">h</Text>}
                            />
                          </div>
                        ))}
                      </Group>

                      <Text size="sm" c={Math.abs(restante) > 0.02 ? 'red' : 'green'}>
                        Restante: {restante.toFixed(2)} h{Math.abs(restante) <= 0.02 ? ' ✓' : ''}
                      </Text>

                      {err && (
                        <Alert color="red" mt="xs" p="xs" icon={<IconAlertCircle size={14} />}>{err}</Alert>
                      )}
                    </Card>
                  );
                })}
              </Stack>
            </ScrollArea.Autosize>
          </Tabs.Panel>
        )}
      </Tabs>

      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>Cancelar Upload</Button>
        <Button onClick={handleConfirm} color="blue" disabled={hasErrors}>
          Confirmar e Processar
        </Button>
      </Group>
    </Modal>
  );
}
