import { G_USUARIO } from './models/G_USUARIO';
import { T_ATO } from './models/T_ATO';
import { QueryInterface } from './orm';
import { orm } from './orm/client';

const AtoModel: any = T_ATO;
const UsuarioModel: any = G_USUARIO;

function logStep(title: string): void {
    console.log(`\n==================== ${title} ====================`);
}

function logInfo(message: string, payload?: unknown): void {
    if (payload !== undefined) {
        console.log(`ℹ️  ${message}`, payload);
        return;
    }
    console.log(`ℹ️  ${message}`);
}

function logOk(message: string, payload?: unknown): void {
    if (payload !== undefined) {
        console.log(`✅ ${message}`, payload);
        return;
    }
    console.log(`✅ ${message}`);
}

async function nextUsuarioId(): Promise<number> {
    const last = await UsuarioModel.findOne({
        attributes: ['USUARIO_ID'],
        order: [['USUARIO_ID', 'DESC']]
    });
    const maxId = Number(last?.dataValues?.USUARIO_ID ?? 0);
    return maxId + 1;
}

async function runPracticalTests(): Promise<void> {
    let createdUsuario: any = null;
    let createdAto: any = null;

    try {
        logStep('INICIO DOS TESTES');
        await orm.authenticate();
        logOk('Conexao com banco autenticada');

        // Associações pedidas: G_USUARIO 1:N T_ATO e T_ATO N:1 G_USUARIO
        UsuarioModel.hasMany(AtoModel, {
            as: 'atos',
            foreignKey: 'USUARIO_ID',
            sourceKey: 'USUARIO_ID'
        });
        AtoModel.belongsTo(UsuarioModel, {
            as: 'usuario',
            foreignKey: 'USUARIO_ID',
            targetKey: 'USUARIO_ID'
        });
        logOk('Associacoes registradas (G_USUARIO.hasMany(T_ATO) e T_ATO.belongsTo(G_USUARIO))');

        // Hooks evidentes
        UsuarioModel.beforeCreate((instance: any) => {
            console.log('🪝 [G_USUARIO.beforeCreate] preparando usuario', {
                USUARIO_ID: instance.get('USUARIO_ID'),
                LOGIN: instance.get('LOGIN')
            });
        });
        UsuarioModel.afterCreate((instance: any) => {
            console.log('🪝 [G_USUARIO.afterCreate] usuario criado', {
                USUARIO_ID: instance.get('USUARIO_ID')
            });
        });
        UsuarioModel.beforeUpdate((instance: any) => {
            console.log('🪝 [G_USUARIO.beforeUpdate] alteracao detectada', {
                USUARIO_ID: instance.get('USUARIO_ID')
            });
        });
        UsuarioModel.afterUpdate((instance: any) => {
            console.log('🪝 [G_USUARIO.afterUpdate] alteracao persistida', {
                USUARIO_ID: instance.get('USUARIO_ID')
            });
        });
        UsuarioModel.beforeDestroy((instance: any) => {
            console.log('🪝 [G_USUARIO.beforeDestroy] removendo usuario', {
                USUARIO_ID: instance.get('USUARIO_ID')
            });
        });
        UsuarioModel.afterDestroy((instance: any) => {
            console.log('🪝 [G_USUARIO.afterDestroy] usuario removido', {
                USUARIO_ID: instance.get('USUARIO_ID')
            });
        });

        AtoModel.beforeCreate((instance: any) => {
            console.log('🪝 [T_ATO.beforeCreate] preparando ato', {
                PROTOCOLO: instance.get('PROTOCOLO'),
                USUARIO_ID: instance.get('USUARIO_ID')
            });
        });
        AtoModel.afterCreate((instance: any) => {
            console.log('🪝 [T_ATO.afterCreate] ato criado', {
                ATO_ID: instance.get('ATO_ID')
            });
        });
        AtoModel.beforeUpdate((instance: any) => {
            console.log('🪝 [T_ATO.beforeUpdate] alteracao detectada', {
                ATO_ID: instance.get('ATO_ID')
            });
        });
        AtoModel.afterUpdate((instance: any) => {
            console.log('🪝 [T_ATO.afterUpdate] alteracao persistida', {
                ATO_ID: instance.get('ATO_ID')
            });
        });
        AtoModel.beforeDestroy((instance: any) => {
            console.log('🪝 [T_ATO.beforeDestroy] removendo ato', {
                ATO_ID: instance.get('ATO_ID')
            });
        });
        AtoModel.afterDestroy((instance: any) => {
            console.log('🪝 [T_ATO.afterDestroy] ato removido', {
                ATO_ID: instance.get('ATO_ID')
            });
        });
        logOk('Hooks before/after create/update/destroy registrados para ambos os models');

        const qi = new QueryInterface(orm.getConnection());

        logStep('1) listTables');
        const tables = await qi.listTables();
        logOk('listTables executado', { total: tables.length, amostra: tables.slice(0, 10) });

        logStep('2) describeTable(T_ATO) e describeTable(G_USUARIO)');
        const atoColumns = await qi.describeTable('T_ATO');
        const usuarioColumns = await qi.describeTable('G_USUARIO');
        logOk('describeTable T_ATO', { totalColunas: atoColumns.length, primeiras: atoColumns.slice(0, 5) });
        logOk('describeTable G_USUARIO', { totalColunas: usuarioColumns.length, primeiras: usuarioColumns.slice(0, 5) });

        logStep('3) create em G_USUARIO e T_ATO (com hooks)');
        const newUsuarioId = await nextUsuarioId();
        const uniqueSuffix = Date.now();
        createdUsuario = await UsuarioModel.create({
            USUARIO_ID: newUsuarioId,
            LOGIN: `orm_teste_${uniqueSuffix}`,
            NOME_COMPLETO: 'Usuario ORM Teste',
            SITUACAO: 'A'
        });
        logOk('G_USUARIO.create executado', createdUsuario.dataValues);

        createdAto = await AtoModel.create({
            PROTOCOLO: Number(String(uniqueSuffix).slice(-9)),
            SITUACAO_ATO: '1',
            ATIVO: 'A',
            USUARIO_ID: createdUsuario.dataValues.USUARIO_ID,
            OBSERVACAO: 'ATO criado pelo teste pratico'
        });
        logOk('T_ATO.create executado', createdAto.dataValues);

        logStep('4) findAll em T_ATO e G_USUARIO (com limite)');
        const atosLimited = await AtoModel.findAll({
            attributes: ['ATO_ID', 'PROTOCOLO', 'USUARIO_ID', 'SITUACAO_ATO'],
            order: [['ATO_ID', 'DESC']],
            limit: 5
        });
        const usuariosLimited = await UsuarioModel.findAll({
            attributes: ['USUARIO_ID', 'LOGIN', 'NOME_COMPLETO', 'SITUACAO'],
            order: [['USUARIO_ID', 'DESC']],
            limit: 5
        });
        logOk('T_ATO.findAll com limit', atosLimited.map((x: any) => x.dataValues));
        logOk('G_USUARIO.findAll com limit', usuariosLimited.map((x: any) => x.dataValues));

        logStep('5) count em T_ATO e G_USUARIO');
        const countAtos = await AtoModel.count();
        const countUsuarios = await UsuarioModel.count();
        logOk('T_ATO.count executado', { total: countAtos });
        logOk('G_USUARIO.count executado', { total: countUsuarios });

        logStep('6) findAndCountAll em T_ATO e G_USUARIO (com limit)');
        const atosFindAndCount = await AtoModel.findAndCountAll({
            attributes: ['ATO_ID', 'PROTOCOLO', 'USUARIO_ID', 'SITUACAO_ATO'],
            order: [['ATO_ID', 'DESC']],
            limit: 5
        });
        const usuariosFindAndCount = await UsuarioModel.findAndCountAll({
            attributes: ['USUARIO_ID', 'LOGIN', 'NOME_COMPLETO', 'SITUACAO'],
            order: [['USUARIO_ID', 'DESC']],
            limit: 5
        });
        logOk('T_ATO.findAndCountAll com limit', {
            count: atosFindAndCount.count,
            rows: atosFindAndCount.rows.map((x: any) => x.dataValues)
        });
        logOk('G_USUARIO.findAndCountAll com limit', {
            count: usuariosFindAndCount.count,
            rows: usuariosFindAndCount.rows.map((x: any) => x.dataValues)
        });

        logStep('7) findByPk em T_ATO e findAll em G_USUARIO');
        const atoByPk = await AtoModel.findByPk(createdAto.dataValues.ATO_ID);
        const usuariosAgain = await UsuarioModel.findAll({
            attributes: ['USUARIO_ID', 'LOGIN'],
            order: [['USUARIO_ID', 'DESC']],
            limit: 3
        });
        logOk('T_ATO.findByPk', atoByPk?.dataValues ?? null);
        logOk('G_USUARIO.findAll (segunda rodada)', usuariosAgain.map((x: any) => x.dataValues));

        logStep('8) findAll em T_ATO com include de G_USUARIO');
        const atosWithUser = await AtoModel.findAll({
            where: { ATO_ID: createdAto.dataValues.ATO_ID },
            attributes: ['ATO_ID', 'PROTOCOLO', 'USUARIO_ID'],
            include: [
                {
                    association: 'usuario',
                    as: 'usuario',
                    attributes: ['USUARIO_ID', 'LOGIN', 'NOME_COMPLETO', 'SITUACAO'],
                    required: false
                }
            ],
            limit: 5
        });
        logOk(
            'T_ATO.findAll com include',
            atosWithUser.map((x: any) => ({
                ...x.dataValues,
                usuario: x.dataValues.usuario
            }))
        );

        logStep('9) update em T_ATO e G_USUARIO (com hooks)');
        createdUsuario.set('NOME_COMPLETO', `Usuario ORM Teste Atualizado ${Date.now()}`);
        createdUsuario.set('SITUACAO', 'I');
        await createdUsuario.save();
        logOk('G_USUARIO atualizado', createdUsuario.dataValues);

        createdAto.set('OBSERVACAO', `ATO atualizado em ${new Date().toISOString()}`);
        createdAto.set('SITUACAO_ATO', '2');
        await createdAto.save();
        logOk('T_ATO atualizado', createdAto.dataValues);

        logStep('10) delete em T_ATO e G_USUARIO (com hooks)');
        await createdAto.destroy();
        logOk('T_ATO.destroy executado', { ATO_ID: createdAto.dataValues.ATO_ID });
        createdAto = null;

        await createdUsuario.destroy();
        logOk('G_USUARIO.destroy executado', { USUARIO_ID: createdUsuario.dataValues.USUARIO_ID });
        createdUsuario = null;

        logStep('FIM DOS TESTES');
        logOk('Todos os testes solicitados foram executados com logs evidentes');
    } catch (error) {
        console.error('\n❌ Falha na bateria de testes:', error);
        process.exitCode = 1;

        // tentativa de limpeza em caso de falha no meio
        try {
            if (createdAto) {
                await createdAto.destroy();
                logInfo('Cleanup: T_ATO de teste removido');
            }
        } catch (cleanupErr) {
            console.error('⚠️  Cleanup T_ATO falhou:', cleanupErr);
        }
        try {
            if (createdUsuario) {
                await createdUsuario.destroy();
                logInfo('Cleanup: G_USUARIO de teste removido');
            }
        } catch (cleanupErr) {
            console.error('⚠️  Cleanup G_USUARIO falhou:', cleanupErr);
        }
    } finally {
        process.exit();
    }
}

runPracticalTests();
