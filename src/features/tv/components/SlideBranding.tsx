import { Center, Image, Text } from '@mantine/core';

export function SlideBranding() {
    return (
        <Center style={{ height: '100%', width: '100%', background: 'white', borderRadius: 16 }}>
            <div style={{ width: '80%', height: '60%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', maxWidth: 800 }}>
                <Image src="/logos/melhoria-continua.png" fit="contain" h={700} w="auto" fallbackSrc="https://placehold.co/800x600?text=Departamento" />
                <Text size="2rem" fw={900} mt="xl" c="dimmed" style={{ letterSpacing: 2 }}>A CADA DIA, UM POUCO MELHOR</Text>
            </div>
        </Center>
    );
}
