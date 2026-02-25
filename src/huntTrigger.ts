import { FirebirdDB } from './database';

async function huntTrigger() {
    try {
        console.log("🕵️ Buscando a Trigger de auto-incremento da tabela T_ATO...");

        // Busca o código fonte da Trigger de "Before Insert" (Tipo 1)
        const sql = `
            SELECT 
                TRIM(RDB$TRIGGER_NAME) AS TRIGGER_NAME,
                RDB$TRIGGER_SOURCE AS SOURCE
            FROM RDB$TRIGGERS 
            WHERE RDB$RELATION_NAME = 'T_ATO' 
              AND RDB$TRIGGER_TYPE = 1 
              AND RDB$TRIGGER_INACTIVE = 0;
        `;

        const results = await FirebirdDB.query<any>(sql);

        if (results.length === 0) {
            console.log("⚠️ Nenhuma Trigger ativa encontrada para T_ATO.");
            console.log("Dica: Talvez a tabela use IDENTITY nativo ou o ID seja manual.");
            return;
        }

        results.forEach(res => {
            console.log(`\n🔔 Trigger Encontrada: ${res.TRIGGER_NAME}`);
            console.log("--- Código Fonte ---");
            console.log(res.SOURCE);
            console.log("--------------------");
            
            // Tenta extrair o nome do Generator do código (padrão: NEXT VALUE FOR NOME)
            const match = res.SOURCE.match(/NEXT\s+VALUE\s+FOR\s+([a-zA-Z0-9_$]+)/i);
            if (match) {
                console.log(`\n💡 O GENERATOR REAL É: ${match[1]}`);
            }
        });

    } catch (error) {
        console.error("❌ Erro na caça à Trigger:", error);
    } finally {
        process.exit();
    }
}

huntTrigger();