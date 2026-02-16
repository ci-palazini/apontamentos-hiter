// src/features/config/ConfigGeralPage.tsx
import { useEffect, useMemo, useState } from 'react';
import {
  Card, Group, Title, Text, Button, Badge, Table, Stack,
  TextInput, NumberInput, Select, ActionIcon, Tooltip, Switch, Loader,
  SegmentedControl, Modal, Tabs, Alert
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { supabase } from '../../lib/supabaseClient';
import {
  IconPlus, IconTrash, IconCheck, IconX, IconSettings, IconTarget,
  IconTags, IconAlertTriangle, IconEdit
} from '@tabler/icons-react';
import { useEmpresaId } from '../../contexts/TenantContext';
import { fetchAliases } from '../../services/db';
import FuncionariosConfigSection from './FuncionariosConfigSection';

type Centro = {
  id: number;
  codigo: string;
  ativo: boolean;
  desativado_desde: string | null;
  escopo: 'usinagem' | 'montagem';
  centro_pai_id: number | null;
  exibir_filhos: boolean;
  turnos_op: number;
};

type Meta = { id: number; centro_id: number; meta_horas: number; vigente_desde: string; vigente_ate: string | null };
type Alias = { id: number; alias_texto: string; centro_id: number };

function isoToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ConfigGeralPage() {
  const empresaId = useEmpresaId();

  const [loading, setLoading] = useState(true);
  const [centros, setCentros] = useState<Centro[]>([]);
  const [metas, setMetas] = useState<Meta[]>([]);
  const [aliases, setAliases] = useState<Alias[]>([]);
  const [mostrarInativos, setMostrarInativos] = useState(false);

  // Modal de edição/detalhes
  const [centroEditando, setCentroEditando] = useState<Centro | null>(null);
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  // Modal de exclusão permanente
  const [centroExcluindo, setCentroExcluindo] = useState<Centro | null>(null);
  const [deleteModalOpened, { open: openDeleteModal, close: closeDeleteModal }] = useDisclosure(false);
  const [confirmDelete, setConfirmDelete] = useState('');

  // Forms
  const [novoCentro, setNovoCentro] = useState('');
  const [novoEscopo, setNovoEscopo] = useState<'usinagem' | 'montagem'>('usinagem');
  const [novaMeta, setNovaMeta] = useState<number | string>('');
  const [vigenteDesde, setVigenteDesde] = useState<string>(isoToday());
  const [novoAlias, setNovoAlias] = useState('');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [centrosRes, metasRes, aliasesRes] = await Promise.all([
        supabase.from('centros').select('id,codigo,ativo,desativado_desde,escopo,centro_pai_id,exibir_filhos').eq('empresa_id', empresaId).order('codigo', { ascending: true }),
        supabase.from('metas_diarias').select('id,centro_id,meta_horas,vigente_desde,vigente_ate').eq('empresa_id', empresaId).order('vigente_desde', { ascending: false }),
        fetchAliases(empresaId),
      ]);

      if (centrosRes.error) throw centrosRes.error;

      setCentros((centrosRes.data ?? []).map((r: any) => ({
        id: Number(r.id),
        codigo: String(r.codigo),
        ativo: Boolean(r.ativo),
        desativado_desde: r.desativado_desde ?? null,
        escopo: r.escopo === 'montagem' ? 'montagem' : 'usinagem',
        centro_pai_id: r.centro_pai_id ? Number(r.centro_pai_id) : null,
        exibir_filhos: Boolean(r.exibir_filhos),
        turnos_op: Number(r.turnos_op || 1)
      })));
      setMetas((metasRes.data ?? []).map((r: any) => ({ ...r, id: Number(r.id), centro_id: Number(r.centro_id), meta_horas: Number(r.meta_horas) })));
      setAliases(aliasesRes);
    } catch (e: any) {
      notifications.show({ title: 'Erro', message: e.message, color: 'red' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, [empresaId]);

  const centrosAtivos = useMemo(() => centros.filter(c => c.ativo), [centros]);
  const centrosInativos = useMemo(() => centros.filter(c => !c.ativo), [centros]);
  const centrosFiltrados = useMemo(() => mostrarInativos ? centros : centrosAtivos, [centros, centrosAtivos, mostrarInativos]);
  const centroOptions = useMemo(() => centros.filter(c => c.ativo).map(c => ({ value: String(c.id), label: c.codigo })), [centros]);

  // Helpers
  const getMetaAtual = (centroId: number) => metas.find(m => m.centro_id === centroId && !m.vigente_ate);
  const getAliasesCount = (centroId: number) => aliases.filter(a => a.centro_id === centroId).length;
  const getPaiNome = (paiId: number | null) => paiId ? centros.find(c => c.id === paiId)?.codigo : null;

  // Ações Centro
  const criarCentro = async () => {
    if (!novoCentro.trim()) return;
    const { error } = await supabase.from('centros').insert({
      codigo: novoCentro.trim(), ativo: true, escopo: novoEscopo, exibir_filhos: false, empresa_id: empresaId
    });
    if (!error) {
      setNovoCentro('');
      await loadAll();
      notifications.show({ title: 'Sucesso', message: 'Centro criado', color: 'green' });
    }
  };

  const toggleAtivoCentro = async (c: Centro) => {
    if (c.ativo) {
      await supabase.from('centros').update({ ativo: false, desativado_desde: isoToday() }).eq('id', c.id);
    } else {
      await supabase.from('centros').update({ ativo: true, desativado_desde: null }).eq('id', c.id);
    }
    loadAll();
  };

  const excluirCentroPermanente = async () => {
    if (!centroExcluindo || confirmDelete !== centroExcluindo.codigo) return;

    const { error } = await supabase.from('centros').delete().eq('id', centroExcluindo.id);
    if (error) {
      notifications.show({ title: 'Erro ao excluir', message: error.message, color: 'red' });
    } else {
      notifications.show({ title: 'Centro excluído', message: 'O centro foi removido permanentemente', color: 'green' });
      closeDeleteModal();
      setCentroExcluindo(null);
      setConfirmDelete('');
      loadAll();
    }
  };

  const abrirExclusao = (c: Centro) => {
    setCentroExcluindo(c);
    setConfirmDelete('');
    openDeleteModal();
  };

  const salvarCentro = async () => {
    if (!centroEditando) return;
    await supabase.from('centros').update({
      codigo: centroEditando.codigo,
      escopo: centroEditando.escopo,
      centro_pai_id: centroEditando.centro_pai_id,
      exibir_filhos: centroEditando.exibir_filhos,
      turnos_op: centroEditando.turnos_op
    }).eq('id', centroEditando.id);
    closeModal();
    loadAll();
    notifications.show({ title: 'Salvo', message: 'Centro atualizado', color: 'green' });
  };

  // Metas
  const criarMeta = async (centroId: number) => {
    if (!novaMeta) return;
    const aberta = metas.find(m => m.centro_id === centroId && m.vigente_ate == null);
    if (aberta) {
      const d = new Date(vigenteDesde); d.setDate(d.getDate() - 1);
      await supabase.from('metas_diarias').update({ vigente_ate: d.toISOString().split('T')[0] }).eq('id', aberta.id);
    }
    await supabase.from('metas_diarias').insert({ centro_id: centroId, meta_horas: Number(novaMeta), vigente_desde: vigenteDesde, empresa_id: empresaId });
    setNovaMeta('');
    loadAll();
    notifications.show({ title: 'Meta criada', message: 'Nova meta definida', color: 'green' });
  };

  // Aliases
  const criarAlias = async (centroId: number) => {
    if (!novoAlias.trim()) return;
    await supabase.from('centro_aliases').insert({ alias_texto: novoAlias.trim(), centro_id: centroId });
    setNovoAlias('');
    loadAll();
    notifications.show({ title: 'Alias criado', message: 'Sucesso', color: 'green' });
  };

  const removerAlias = async (id: number) => {
    await supabase.from('centro_aliases').delete().eq('id', id);
    loadAll();
  };

  const abrirEdicao = (c: Centro) => {
    setCentroEditando({ ...c });
    setNovaMeta('');
    setNovoAlias('');
    setVigenteDesde(isoToday());
    openModal();
  };

  return (
    <div>
      <Group justify="space-between" mb="lg">
        <div>
          <Title order={2}>Configurações</Title>
          <Text c="dimmed" size="sm">Gerencie centros de trabalho, metas e aliases</Text>
        </div>
        <Switch
          checked={mostrarInativos}
          onChange={(e) => setMostrarInativos(e.currentTarget.checked)}
          label={<Text size="sm">Mostrar inativos ({centrosInativos.length})</Text>}
        />
      </Group>

      {loading ? (
        <Group justify="center" py="xl"><Loader /></Group>
      ) : (
        <Stack gap="lg">
          {/* Criar Novo Centro */}
          <Card withBorder shadow="sm" radius="md" p="md">
            <Group gap="md" align="end">
              <TextInput
                label="Novo Centro"
                placeholder="Ex: CNC-01"
                value={novoCentro}
                onChange={(e) => setNovoCentro(e.currentTarget.value)}
                style={{ flex: 1 }}
              />
              <SegmentedControl
                value={novoEscopo}
                onChange={(v: any) => setNovoEscopo(v)}
                data={[{ label: 'Usinagem', value: 'usinagem' }, { label: 'Montagem', value: 'montagem' }]}
                size="sm"
              />
              <Button leftSection={<IconPlus size={16} />} onClick={criarCentro}>
                Criar
              </Button>
            </Group>
          </Card>

          {/* Lista de Centros */}
          <Card withBorder shadow="sm" radius="md" p="md">
            <Title order={4} mb="md">Centros de Trabalho</Title>

            <Table highlightOnHover withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Centro</Table.Th>
                  <Table.Th>Escopo</Table.Th>
                  <Table.Th>Meta Atual</Table.Th>
                  <Table.Th>Agrupador</Table.Th>
                  <Table.Th>Aliases</Table.Th>
                  <Table.Th>Status</Table.Th>
                  <Table.Th w={120}>Ações</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {centrosFiltrados.map((c) => {
                  const metaAtual = getMetaAtual(c.id);
                  const aliasCount = getAliasesCount(c.id);
                  const paiNome = getPaiNome(c.centro_pai_id);

                  return (
                    <Table.Tr key={c.id} style={{ opacity: c.ativo ? 1 : 0.6 }}>
                      <Table.Td>
                        <Text fw={600}>{c.codigo}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          variant="light"
                          color={c.escopo === 'usinagem' ? 'orange' : 'violet'}
                          size="sm"
                        >
                          {c.escopo === 'usinagem' ? 'Usinagem' : 'Montagem'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        {metaAtual ? (
                          <Text size="sm">{metaAtual.meta_horas.toFixed(1)} h/dia</Text>
                        ) : (
                          <Text size="sm" c="dimmed">Sem meta</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {paiNome ? (
                          <Badge variant="outline" size="sm">{paiNome}</Badge>
                        ) : (
                          <Text size="sm" c="dimmed">—</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        {aliasCount > 0 ? (
                          <Badge variant="dot" size="sm">{aliasCount}</Badge>
                        ) : (
                          <Text size="sm" c="dimmed">—</Text>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Badge
                          variant="light"
                          color={c.ativo ? 'green' : 'gray'}
                          size="sm"
                        >
                          {c.ativo ? 'Ativo' : 'Inativo'}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs">
                          <Tooltip label="Editar detalhes">
                            <ActionIcon variant="light" color="blue" onClick={() => abrirEdicao(c)}>
                              <IconEdit size={16} />
                            </ActionIcon>
                          </Tooltip>
                          <Tooltip label={c.ativo ? 'Desativar' : 'Reativar'}>
                            <ActionIcon
                              variant="light"
                              color={c.ativo ? 'yellow' : 'green'}
                              onClick={() => toggleAtivoCentro(c)}
                            >
                              {c.ativo ? <IconX size={16} /> : <IconCheck size={16} />}
                            </ActionIcon>
                          </Tooltip>
                          {!c.ativo && (
                            <Tooltip label="Excluir permanentemente">
                              <ActionIcon variant="light" color="red" onClick={() => abrirExclusao(c)}>
                                <IconTrash size={16} />
                              </ActionIcon>
                            </Tooltip>
                          )}
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
                {centrosFiltrados.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={7}>
                      <Text c="dimmed" ta="center" py="md">Nenhum centro encontrado</Text>
                    </Table.Td>
                  </Table.Tr>
                )}
              </Table.Tbody>
            </Table>
          </Card>

          {/* Seção de Funcionários & Máquinas */}
          <FuncionariosConfigSection />
        </Stack>
      )}

      {/* Modal de Edição */}
      <Modal
        opened={modalOpened}
        onClose={closeModal}
        title={<Group gap="xs"><IconSettings size={20} /><Text fw={600}>Editar Centro: {centroEditando?.codigo}</Text></Group>}
        size="lg"
      >
        {centroEditando && (
          <Tabs defaultValue="geral">
            <Tabs.List mb="md">
              <Tabs.Tab value="geral" leftSection={<IconSettings size={14} />}>Geral</Tabs.Tab>
              <Tabs.Tab value="meta" leftSection={<IconTarget size={14} />}>Meta</Tabs.Tab>
              <Tabs.Tab value="aliases" leftSection={<IconTags size={14} />}>Aliases</Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="geral">
              <Stack gap="md">
                <TextInput
                  label="Código do Centro"
                  value={centroEditando.codigo}
                  onChange={(e) => setCentroEditando({ ...centroEditando, codigo: e.currentTarget.value })}
                />
                <SegmentedControl
                  value={centroEditando.escopo}
                  onChange={(v: any) => setCentroEditando({ ...centroEditando, escopo: v })}
                  data={[{ label: 'Usinagem', value: 'usinagem' }, { label: 'Montagem', value: 'montagem' }]}
                  fullWidth
                />

                <NumberInput
                  label="Turnos de Operação"
                  description="Quantos turnos esta máquina opera (1, 2 ou 3). Afeta cálculo de meta por turno."
                  min={1}
                  max={3}
                  value={centroEditando.turnos_op}
                  onChange={(v) => setCentroEditando({ ...centroEditando, turnos_op: Number(v) || 1 })}
                />

                <Select
                  label="Agrupador (Centro Pai)"
                  placeholder="Nenhum"
                  clearable
                  value={centroEditando.centro_pai_id ? String(centroEditando.centro_pai_id) : null}
                  onChange={(val) => setCentroEditando({ ...centroEditando, centro_pai_id: val ? Number(val) : null })}
                  data={centroOptions.filter(opt => opt.value !== String(centroEditando.id))}
                />
                {!centroEditando.centro_pai_id && (
                  <Switch
                    label="Exibir filhos como cards individuais"
                    description="Se ativado, os centros filhos também aparecem separados no dashboard"
                    checked={centroEditando.exibir_filhos}
                    onChange={(e) => setCentroEditando({ ...centroEditando, exibir_filhos: e.currentTarget.checked })}
                  />
                )}
                <Group justify="flex-end" mt="md">
                  <Button variant="default" onClick={closeModal}>Cancelar</Button>
                  <Button onClick={salvarCentro}>Salvar</Button>
                </Group>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="meta">
              <Stack gap="md">
                <Alert variant="light" color="blue" icon={<IconTarget size={16} />}>
                  Meta atual: <strong>{getMetaAtual(centroEditando.id)?.meta_horas.toFixed(1) ?? 'Nenhuma'}</strong> h/dia
                </Alert>
                <Group grow align="end">
                  <NumberInput
                    label="Nova meta (h/dia)"
                    placeholder="Ex: 8"
                    min={0.1}
                    decimalScale={2}
                    value={novaMeta}
                    onChange={(v) => setNovaMeta(Number(v) || '')}
                  />
                  <TextInput
                    label="Vigente desde"
                    type="date"
                    value={vigenteDesde}
                    onChange={(e) => setVigenteDesde(e.currentTarget.value)}
                  />
                </Group>
                <Button
                  leftSection={<IconPlus size={16} />}
                  onClick={() => criarMeta(centroEditando.id)}
                  disabled={!novaMeta}
                >
                  Definir Nova Meta
                </Button>
                <Text size="xs" c="dimmed">A meta anterior será encerrada automaticamente</Text>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="aliases">
              <Stack gap="md">
                <Text size="sm" c="dimmed">
                  Aliases são nomes alternativos usados na importação de dados
                </Text>
                <Group>
                  <TextInput
                    placeholder="Novo alias"
                    value={novoAlias}
                    onChange={(e) => setNovoAlias(e.currentTarget.value)}
                    style={{ flex: 1 }}
                  />
                  <Button
                    leftSection={<IconPlus size={16} />}
                    onClick={() => criarAlias(centroEditando.id)}
                    disabled={!novoAlias.trim()}
                  >
                    Adicionar
                  </Button>
                </Group>
                <Table withTableBorder>
                  <Table.Tbody>
                    {aliases.filter(a => a.centro_id === centroEditando.id).map(a => (
                      <Table.Tr key={a.id}>
                        <Table.Td>{a.alias_texto}</Table.Td>
                        <Table.Td w={40}>
                          <ActionIcon color="red" variant="subtle" size="sm" onClick={() => removerAlias(a.id)}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                    {aliases.filter(a => a.centro_id === centroEditando.id).length === 0 && (
                      <Table.Tr><Table.Td colSpan={2}><Text c="dimmed" size="sm">Nenhum alias</Text></Table.Td></Table.Tr>
                    )}
                  </Table.Tbody>
                </Table>
              </Stack>
            </Tabs.Panel>
          </Tabs>
        )}
      </Modal>

      {/* Modal de Exclusão Permanente */}
      <Modal
        opened={deleteModalOpened}
        onClose={closeDeleteModal}
        title={<Group gap="xs"><IconAlertTriangle size={20} color="red" /><Text fw={600} c="red">Excluir Permanentemente</Text></Group>}
        size="md"
      >
        {centroExcluindo && (
          <Stack gap="md">
            <Alert variant="light" color="red" icon={<IconAlertTriangle size={16} />}>
              Esta ação é <strong>irreversível</strong>. Todos os dados relacionados a este centro serão excluídos, incluindo:
              <ul style={{ margin: '8px 0', paddingLeft: 20 }}>
                <li>Histórico de metas</li>
                <li>Totais diários</li>
                <li>Aliases</li>
              </ul>
            </Alert>

            <Text size="sm">
              Para confirmar, digite o código do centro: <strong>{centroExcluindo.codigo}</strong>
            </Text>

            <TextInput
              placeholder={centroExcluindo.codigo}
              value={confirmDelete}
              onChange={(e) => setConfirmDelete(e.currentTarget.value)}
            />

            <Group justify="flex-end">
              <Button variant="default" onClick={closeDeleteModal}>Cancelar</Button>
              <Button
                color="red"
                onClick={excluirCentroPermanente}
                disabled={confirmDelete !== centroExcluindo.codigo}
              >
                Excluir Permanentemente
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </div>
  );
}