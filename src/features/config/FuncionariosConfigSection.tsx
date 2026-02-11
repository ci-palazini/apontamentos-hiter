// src/features/config/FuncionariosConfigSection.tsx
import { useEffect, useMemo, useState } from 'react';
import {
    Card, Group, Title, Text, Button, Badge, Table, Stack,
    TextInput, ActionIcon, Tooltip, Modal, Loader, MultiSelect, Select
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconPlus, IconTrash, IconEdit, IconUsers } from '@tabler/icons-react';
import { useEmpresaId } from '../../contexts/TenantContext';
import { supabase } from '../../lib/supabaseClient';
import {
    fetchFuncionariosComCentros,
    upsertFuncionarioMeta,
    setFuncionarioCentros,
    type FuncionarioComCentros,
    type AreaFuncionario
} from '../../services/funcionarios';

type Centro = { id: number; codigo: string; ativo: boolean };

export default function FuncionariosConfigSection() {
    const empresaId = useEmpresaId();
    const [loading, setLoading] = useState(true);
    const [funcionarios, setFuncionarios] = useState<FuncionarioComCentros[]>([]);
    const [centros, setCentros] = useState<Centro[]>([]);

    // Modal de edição
    const [editFunc, setEditFunc] = useState<FuncionarioComCentros | null>(null);
    const [editNome, setEditNome] = useState('');
    const [editMatricula, setEditMatricula] = useState('');
    const [matriculaErro, setMatriculaErro] = useState<string | null>(null);
    const [editCentros, setEditCentros] = useState<string[]>([]);
    const [editMeta, setEditMeta] = useState('');
    const [editArea, setEditArea] = useState<string | null>(null);
    const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);
    const [saving, setSaving] = useState(false);

    const loadAll = async () => {
        setLoading(true);
        try {
            const [funcs, centrosRes] = await Promise.all([
                fetchFuncionariosComCentros(empresaId),
                supabase.from('centros').select('id, codigo, ativo').eq('empresa_id', empresaId).eq('ativo', true).order('codigo'),
            ]);
            setFuncionarios(funcs);
            setCentros((centrosRes.data ?? []) as Centro[]);
        } catch (e: any) {
            notifications.show({ title: 'Erro', message: e.message, color: 'red' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { loadAll(); }, [empresaId]);

    const centroOptions = useMemo(() =>
        centros.map(c => ({ value: String(c.id), label: c.codigo })),
        [centros]
    );

    const centroMap = useMemo(() => {
        const m = new Map<number, string>();
        for (const c of centros) m.set(c.id, c.codigo);
        return m;
    }, [centros]);

    const abrirNovo = () => {
        setEditFunc(null);
        setEditMatricula('');
        setMatriculaErro(null);
        setEditNome('');
        setEditCentros([]);
        setEditMeta('8');
        setEditArea(null);
        openModal();
    };

    const abrirEdicao = (f: FuncionarioComCentros) => {
        setEditFunc(f);
        setEditMatricula(f.matricula);
        setMatriculaErro(null);
        setEditNome(f.nome);
        setEditCentros(f.centros.map(String));
        setEditMeta(String(f.meta_diaria_horas));
        setEditArea(f.area ?? null);
        openModal();
    };

    const salvar = async () => {
        if (!editMatricula.trim() || !editNome.trim()) {
            notifications.show({ title: 'Campos obrigatórios', message: 'Preencha matrícula e nome', color: 'orange' });
            return;
        }
        if (matriculaErro) {
            notifications.show({ title: 'Erro', message: 'Corrija a matrícula antes de salvar', color: 'red' });
            return;
        }
        setSaving(true);
        try {
            // Upsert funcionario_meta
            await upsertFuncionarioMeta(empresaId, {
                id: editFunc?.id,
                matricula: editMatricula.trim(),
                nome: editNome.trim(),
                meta_diaria_horas: Number(editMeta) || 8,
                area: editArea as AreaFuncionario | null,
                ativo: true,
            });

            // Buscar o ID do funcionario recém-criado/atualizado
            const { data: metaRow } = await supabase
                .from('funcionarios_meta')
                .select('id')
                .eq('empresa_id', empresaId)
                .eq('matricula', editMatricula.trim())
                .single();

            if (metaRow) {
                await setFuncionarioCentros(
                    empresaId,
                    metaRow.id,
                    editCentros.map(Number)
                );
            }

            notifications.show({ title: 'Salvo', message: 'Funcionário atualizado', color: 'green' });
            closeModal();
            await loadAll();
        } catch (e: any) {
            notifications.show({ title: 'Erro', message: e.message, color: 'red' });
        } finally {
            setSaving(false);
        }
    };

    const excluir = async (f: FuncionarioComCentros) => {
        if (!confirm(`Excluir funcionário ${f.matricula} - ${f.nome}?`)) return;
        try {
            await supabase.from('funcionarios_meta').delete().eq('id', f.id);
            notifications.show({ title: 'Excluído', message: 'Funcionário removido', color: 'green' });
            await loadAll();
        } catch (e: any) {
            notifications.show({ title: 'Erro', message: e.message, color: 'red' });
        }
    };

    if (loading) {
        return (
            <Card withBorder shadow="sm" radius="md" p="md" mt="lg">
                <Group justify="center" py="xl"><Loader /></Group>
            </Card>
        );
    }

    return (
        <>
            <Card withBorder shadow="sm" radius="md" p="md" mt="lg">
                <Group justify="space-between" mb="md">
                    <Group gap="xs">
                        <IconUsers size={20} />
                        <Title order={4}>Funcionários & Máquinas Vinculadas</Title>
                        <Badge variant="light">{funcionarios.length} cadastrados</Badge>
                    </Group>
                    <Button leftSection={<IconPlus size={16} />} onClick={abrirNovo} size="sm">
                        Novo Funcionário
                    </Button>
                </Group>

                <Table highlightOnHover withTableBorder>
                    <Table.Thead>
                        <Table.Tr>
                            <Table.Th>Matrícula</Table.Th>
                            <Table.Th>Nome</Table.Th>
                            <Table.Th>Área</Table.Th>
                            <Table.Th>Meta Diária</Table.Th>
                            <Table.Th>Máquinas Vinculadas</Table.Th>
                            <Table.Th w={100}>Ações</Table.Th>
                        </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                        {funcionarios.map(f => (
                            <Table.Tr key={f.id}>
                                <Table.Td>
                                    <Text fw={600} ff="monospace">{f.matricula}</Text>
                                </Table.Td>
                                <Table.Td>{f.nome}</Table.Td>
                                <Table.Td>
                                    {f.area ? (
                                        <Badge variant="light" color={f.area === 'Montagem' ? 'blue' : f.area === 'Pintura' ? 'grape' : 'orange'}>
                                            {f.area}
                                        </Badge>
                                    ) : (
                                        <Text c="dimmed" size="sm">—</Text>
                                    )}
                                </Table.Td>
                                <Table.Td>
                                    <Text size="sm">{f.meta_diaria_horas.toFixed(1)} h/dia</Text>
                                </Table.Td>
                                <Table.Td>
                                    {f.centros.length > 0 ? (
                                        <Group gap={4} wrap="wrap">
                                            {f.centros.map(cid => (
                                                <Badge key={cid} variant="light" color="blue" size="sm">
                                                    {centroMap.get(cid) ?? `ID ${cid}`}
                                                </Badge>
                                            ))}
                                        </Group>
                                    ) : (
                                        <Text c="dimmed" size="sm">Nenhuma máquina</Text>
                                    )}
                                </Table.Td>
                                <Table.Td>
                                    <Group gap="xs">
                                        <Tooltip label="Editar">
                                            <ActionIcon variant="light" color="blue" onClick={() => abrirEdicao(f)}>
                                                <IconEdit size={16} />
                                            </ActionIcon>
                                        </Tooltip>
                                        <Tooltip label="Excluir">
                                            <ActionIcon variant="light" color="red" onClick={() => excluir(f)}>
                                                <IconTrash size={16} />
                                            </ActionIcon>
                                        </Tooltip>
                                    </Group>
                                </Table.Td>
                            </Table.Tr>
                        ))}
                        {funcionarios.length === 0 && (
                            <Table.Tr>
                                <Table.Td colSpan={6}>
                                    <Text c="dimmed" ta="center" py="md">
                                        Nenhum funcionário cadastrado. Clique em "Novo Funcionário" para começar.
                                    </Text>
                                </Table.Td>
                            </Table.Tr>
                        )}
                    </Table.Tbody>
                </Table>
            </Card>

            {/* Modal de Edição / Criação */}
            <Modal
                opened={modalOpened}
                onClose={closeModal}
                title={
                    <Group gap="xs">
                        <IconUsers size={20} />
                        <Text fw={600}>
                            {editFunc ? `Editar: ${editFunc.matricula} - ${editFunc.nome}` : 'Novo Funcionário'}
                        </Text>
                    </Group>
                }
                size="lg"
            >
                <Stack gap="md">
                    <Group grow>
                        <TextInput
                            label="Matrícula"
                            placeholder="Ex: 65"
                            value={editMatricula}
                            onChange={(e) => {
                                setEditMatricula(e.currentTarget.value);
                                if (matriculaErro) setMatriculaErro(null);
                            }}
                            onBlur={() => {
                                if (!editFunc && editMatricula.trim()) {
                                    const existe = funcionarios.some(f => f.matricula === editMatricula.trim());
                                    if (existe) setMatriculaErro('Matrícula já registrada');
                                }
                            }}
                            error={matriculaErro}
                            disabled={!!editFunc}
                            required
                        />
                        <TextInput
                            label="Nome"
                            placeholder="Nome do funcionário"
                            value={editNome}
                            onChange={e => setEditNome(e.currentTarget.value)}
                            required
                        />
                    </Group>

                    <TextInput
                        label="Meta diária (horas)"
                        placeholder="Ex: 8"
                        value={editMeta}
                        onChange={e => setEditMeta(e.currentTarget.value)}
                        type="number"
                        min={0}
                        step={0.5}
                    />

                    <Select
                        label="Área"
                        placeholder="Selecione a área"
                        data={[
                            { value: 'Montagem', label: 'Montagem' },
                            { value: 'Pintura', label: 'Pintura' },
                            { value: 'Usinagem', label: 'Usinagem' },
                        ]}
                        value={editArea}
                        onChange={setEditArea}
                        clearable
                    />

                    <MultiSelect
                        label="Máquinas Vinculadas"
                        description="Selecione as máquinas que este funcionário opera. No upload, horas em máquinas fora desta lista serão realocadas."
                        placeholder="Selecione máquinas..."
                        data={centroOptions}
                        value={editCentros}
                        onChange={setEditCentros}
                        searchable
                        clearable
                    />

                    <Group justify="flex-end" mt="md">
                        <Button variant="default" onClick={closeModal}>Cancelar</Button>
                        <Button onClick={salvar} loading={saving} disabled={!!matriculaErro}>
                            {editFunc ? 'Salvar' : 'Criar Funcionário'}
                        </Button>
                    </Group>
                </Stack>
            </Modal>
        </>
    );
}
