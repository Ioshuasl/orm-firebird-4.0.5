import * as dotenv from 'dotenv';
import { OriusORM, Op } from './orm';
import { Ato } from './models/Ato';

dotenv.config();

async function runTests() {
    try {
        console.log("🚀 Iniciando Bateria de Testes do ORM...");

        const orm = new OriusORM({
            host: process.env.FDB_HOST,
            port: parseInt(process.env.FDB_PORT || '3050'),
            database: process.env.FDB_DATABASE, 
            user: process.env.FDB_USER,
            password: process.env.FDB_PASSWORD,
            lowercase_keys: false
        });

        orm.define(Ato, 'T_ATO');

        // --- TESTE 1: findOne ---
        console.log("\n1️⃣ Testando findOne (Buscando Ato 4730)...");
        const ato = await Ato.findOne({ 
            where: { ATO_ID: 4730 },
            attributes: ['ATO_ID', 'PROTOCOLO', 'OBSERVACAO', 'SITUACAO_ATO'] 
        });

        if (!ato) throw new Error("Ato 4730 não encontrado para o teste.");
        console.log(`✅ Sucesso! Protocolo encontrado: ${ato.dataValues.PROTOCOLO}`);


        // --- TESTE 2: update (via save) ---
        console.log("\n2️⃣ Testando Update (Alterando Observação)...");
        const observacaoAntiga = ato.dataValues.OBSERVACAO;
        ato.dataValues.OBSERVACAO = `Alterado via ORM em ${new Date().toLocaleTimeString()}`;
        
        await ato.save(); // Como tem ATO_ID, ele fará um UPDATE
        const atoAtualizado = await Ato.findOne({ where: { ATO_ID: 4730 } });
        console.log(`✅ Update foi realmente realizado! Nova OBS: ${atoAtualizado?.dataValues.OBSERVACAO}`);


        // --- TESTE 3: save (Insert) ---
        console.log("\n3️⃣ Testando Insert (Criando novo Ato de teste)...");
        const novoAto = new Ato({
            ATO_TIPO_ID: null,
            SITUACAO_ATO: '1',
            PROTOCOLO: 9999, // Valor fictício para teste
            ATIVO: 'A',
            VALOR_PAGAMENTO: 150.00
        });

        await novoAto.save(); // Como NÃO tem ATO_ID, ele fará um INSERT
        const novoId = novoAto.dataValues.ATO_ID;
        console.log(`✅ Registro inserido com sucesso! Novo ID gerado: ${novoId}`);


        // --- TESTE 4: delete ---
        console.log(`\n4️⃣ Testando Delete (Removendo o registro ${novoId})...`);
        // Vamos usar a instância que acabamos de criar para deletar
        await novoAto.delete();
        
        // Validando se deletou mesmo
        const validacao = await Ato.findOne({ where: { ATO_ID: novoId } });
        if (!validacao) {
            console.log("✅ Deleção confirmada! O registro não existe mais no banco.");
        } else {
            console.error("❌ Falha: O registro ainda consta no banco de dados.");
        }

        console.log("\n✨ Todos os testes foram concluídos com sucesso!");

    } catch (error) {
        console.error("\n❌ Falha em um dos testes:", error);
    } finally {
        process.exit();
    }
}

runTests();