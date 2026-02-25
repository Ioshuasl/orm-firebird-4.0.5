import { FirebirdDB } from './database';

async function listGenerators() {
    try {
        console.log("🔍 Buscando Generators (Sequences) no banco de dados...");

        // Query que busca apenas generators criados por usuários (System Flag = 0)
        const sql = `
            SELECT 
                TRIM(RDB$GENERATOR_NAME) AS GENERATOR_NAME,
                RDB$GENERATOR_ID AS ID
            FROM RDB$GENERATORS 
            WHERE RDB$SYSTEM_FLAG = 0
            ORDER BY RDB$GENERATOR_NAME;
        `;

        const results = await FirebirdDB.query<any>(sql);

        if (results.length === 0) {
            console.log("⚠️ Nenhum Generator customizado foi encontrado no banco.");
            return;
        }

        console.log(`✅ Foram encontrados ${results.length} contadores:`);
        console.table(results);

        // Sugestão baseada na sua tabela T_ATO
        const sugestoes = results.filter(r => 
            r.GENERATOR_NAME.includes('ATO') || 
            r.GENERATOR_NAME.includes('GEN')
        );

        if (sugestoes.length > 0) {
            console.log("\n💡 Sugestões para sua tabela T_ATO:");
            sugestoes.forEach(s => console.log(`- ${s.GENERATOR_NAME}`));
        }

    } catch (error) {
        console.error("❌ Erro ao listar generators:", error);
    } finally {
        process.exit();
    }
}

listGenerators();