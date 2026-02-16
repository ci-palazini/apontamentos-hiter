
import { Modal, Button, Table, Text, TextInput, Group, Badge, ScrollArea, Title, SegmentedControl } from '@mantine/core';
import { useState, useMemo } from 'react';

export type MissingUser = {
    matricula: string;
    nome: string;
    machineCodes: string[]; // Codes to display
    machineIds: number[];   // IDs to link
};

export type MissingLink = {
    matricula: string;
    nome: string;
    machineCodes: string[];
    machineIds: number[];
};

interface LinkResolutionModalProps {
    opened: boolean;
    onClose: () => void;
    onConfirm: (
        newUsers: { matricula: string; nome: string; centroIds: number[]; turno: number }[],
        newLinks: { matricula: string; centroIds: number[] }[]
    ) => void;
    missingUsers: MissingUser[];
    missingLinks: MissingLink[];
}

export default function LinkResolutionModal({
    opened,
    onClose,
    onConfirm,
    missingUsers,
    missingLinks
}: LinkResolutionModalProps) {
    // State for new users (to edit names and shift)
    const [newUsersState, setNewUsersState] = useState<{ matricula: string; nome: string; turno: number }[]>([]);

    // Initialize state when props change
    useMemo(() => {
        setNewUsersState(
            missingUsers.map(u => ({ matricula: u.matricula, nome: '', turno: 1 }))
        );
    }, [missingUsers]);

    const handleNameChange = (matricula: string, val: string) => {
        setNewUsersState(prev => prev.map(u => u.matricula === matricula ? { ...u, nome: val } : u));
    };

    const handleTurnoChange = (matricula: string, val: number) => {
        setNewUsersState(prev => prev.map(u => u.matricula === matricula ? { ...u, turno: val } : u));
    };

    const handleConfirm = () => {
        const usersToCreate = missingUsers.map(u => {
            const state = newUsersState.find(s => s.matricula === u.matricula);
            return {
                matricula: u.matricula,
                nome: state?.nome?.trim() || `Func ${u.matricula}`, // Fallback
                centroIds: u.machineIds,
                turno: state?.turno || 1
            };
        });

        const linksToCreate = missingLinks.map(l => ({
            matricula: l.matricula,
            centroIds: l.machineIds
        }));

        onConfirm(usersToCreate, linksToCreate);
    };

    const totalIssues = missingUsers.length + missingLinks.length;

    return (
        <Modal opened={opened} onClose={onClose} title={`Resolver Pendências de Vínculo (${totalIssues})`} size="xl">
            <ScrollArea.Autosize mah="70vh">

                {missingUsers.length > 0 && (
                    <>
                        <Title order={5} mb="xs" c="red">Funcionários Não Cadastrados ({missingUsers.length})</Title>
                        <Text size="sm" mb="md">Estes funcionários serão <b>cadastrados</b> e vinculados às máquinas listadas.</Text>

                        <Table withTableBorder mb="xl">
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Matrícula</Table.Th>
                                    <Table.Th>Nome (Obrigatório)</Table.Th>
                                    <Table.Th>Máquinas a Vincular</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {missingUsers.map((u) => {
                                    const userState = newUsersState.find(s => s.matricula === u.matricula);
                                    return (
                                        <Table.Tr key={u.matricula}>
                                            <Table.Td>{u.matricula}</Table.Td>
                                            <Table.Td>
                                                <Group grow>
                                                    <TextInput
                                                        placeholder="Nome Completo"
                                                        value={userState?.nome || ''}
                                                        onChange={(e) => handleNameChange(u.matricula, e.currentTarget.value)}
                                                    />
                                                    <div style={{ flex: '0 0 160px' }}>
                                                        <SegmentedControl
                                                            value={String(userState?.turno || 1)}
                                                            onChange={(v: string) => handleTurnoChange(u.matricula, Number(v))}
                                                            data={[
                                                                { label: '1º T', value: '1' },
                                                                { label: '2º T', value: '2' },
                                                                { label: '3º T', value: '3' },
                                                            ]}
                                                            size="xs"
                                                        />
                                                    </div>
                                                </Group>
                                            </Table.Td>
                                            <Table.Td>
                                                <Group gap={4}>
                                                    {u.machineCodes.map(c => <Badge key={c} size="sm" variant="outline">{c}</Badge>)}
                                                </Group>
                                            </Table.Td>
                                        </Table.Tr>
                                    );
                                })}
                            </Table.Tbody>
                        </Table>
                    </>
                )}

                {missingLinks.length > 0 && (
                    <>
                        <Title order={5} mb="xs" c="orange">Novos Vínculos ({missingLinks.length})</Title>
                        <Text size="sm" mb="md">Estes funcionários já existem, mas serão <b>vinculados</b> a novas máquinas encontradas no arquivo.</Text>

                        <Table withTableBorder mb="md">
                            <Table.Thead>
                                <Table.Tr>
                                    <Table.Th>Matrícula</Table.Th>
                                    <Table.Th>Nome Atual</Table.Th>
                                    <Table.Th>Novas Máquinas a Vincular</Table.Th>
                                </Table.Tr>
                            </Table.Thead>
                            <Table.Tbody>
                                {missingLinks.map((l) => (
                                    <Table.Tr key={l.matricula}>
                                        <Table.Td>{l.matricula}</Table.Td>
                                        <Table.Td>{l.nome}</Table.Td>
                                        <Table.Td>
                                            <Group gap={4}>
                                                {l.machineCodes.map(c => <Badge key={c} size="sm" variant="outline">{c}</Badge>)}
                                            </Group>
                                        </Table.Td>
                                    </Table.Tr>
                                ))}
                            </Table.Tbody>
                        </Table>
                    </>
                )}

                <Group justify="flex-end" mt="xl">
                    <Button variant="default" onClick={onClose}>Cancelar</Button>
                    <Button onClick={handleConfirm} color="blue">Confirmar e Processar</Button>
                </Group>

            </ScrollArea.Autosize>
        </Modal >
    );
}
