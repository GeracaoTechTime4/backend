import { systemClock } from "core-kernel";
import {
  AceitarTrocaTurnoUseCase,
  AprovarTrocaTurnoUseCase,
  AtualizarTurnoUseCase,
  BuscarSolicitacaoTrocaTurnoPorIdUseCase,
  CancelarTrocaTurnoUseCase,
  CriarFuncionarioUseCase,
  CriarSupervisorUseCase,
  CriarTurnoUseCase,
  ExpirarSolicitacoesTrocaTurnoUseCase,
  ListarFuncionariosUseCase,
  ListarSolicitacoesTrocaTurnoUseCase,
  ListarSolicitacoesRecebidasTrocaTurnoUseCase,
  ListarTurnosPorFuncionarioEDataUseCase,
  ListarTurnosUseCase,
  RecusarTrocaTurnoUseCase,
  RejeitarTrocaTurnoUseCase,
  RemoverTurnoUseCase,
  SolicitarTrocaTurnoUseCase,
} from "shift-swap";
import { pool } from "../db";
import { PgFuncionarioRepository } from "./funcionario.repository";
import { PgSolicitacaoTrocaTurnoRepository } from "./solicitacao-troca-turno.repository";
import { PgSupervisorRepository } from "./supervisor.repository";
import { PgTurnoRepository } from "./turno.repository";

const funcionarioRepository = new PgFuncionarioRepository(pool);
const supervisorRepository = new PgSupervisorRepository(pool);
const turnoRepository = new PgTurnoRepository(pool);
const solicitacaoRepository = new PgSolicitacaoTrocaTurnoRepository(pool);

export const criarFuncionario = new CriarFuncionarioUseCase(funcionarioRepository);
export const criarSupervisor = new CriarSupervisorUseCase(supervisorRepository);
export const listarFuncionarios = new ListarFuncionariosUseCase(funcionarioRepository);
export const listarTurnos = new ListarTurnosUseCase(turnoRepository);
export const listarTurnosPorFuncionarioEData = new ListarTurnosPorFuncionarioEDataUseCase(turnoRepository);
export const criarTurno = new CriarTurnoUseCase(supervisorRepository, turnoRepository);
export const atualizarTurno = new AtualizarTurnoUseCase(supervisorRepository, turnoRepository);
export const removerTurno = new RemoverTurnoUseCase(supervisorRepository, turnoRepository);

export const solicitarTrocaTurno = new SolicitarTrocaTurnoUseCase(
  turnoRepository,
  funcionarioRepository,
  solicitacaoRepository,
);
// Use cases que registram data (resposta, decisão) recebem o relógio do sistema.
export const aceitarTrocaTurno = new AceitarTrocaTurnoUseCase(turnoRepository, solicitacaoRepository, systemClock);
export const recusarTrocaTurno = new RecusarTrocaTurnoUseCase(solicitacaoRepository, systemClock);
export const aprovarTrocaTurno = new AprovarTrocaTurnoUseCase(
  supervisorRepository,
  turnoRepository,
  solicitacaoRepository,
  systemClock,
);
export const rejeitarTrocaTurno = new RejeitarTrocaTurnoUseCase(supervisorRepository, solicitacaoRepository, systemClock);
export const cancelarTrocaTurno = new CancelarTrocaTurnoUseCase(solicitacaoRepository);
export const expirarSolicitacoesTrocaTurno = new ExpirarSolicitacoesTrocaTurnoUseCase(solicitacaoRepository);
export const listarSolicitacoesTrocaTurno = new ListarSolicitacoesTrocaTurnoUseCase(solicitacaoRepository);
export const listarSolicitacoesRecebidas = new ListarSolicitacoesRecebidasTrocaTurnoUseCase(solicitacaoRepository);
export const buscarSolicitacaoTrocaTurnoPorId = new BuscarSolicitacaoTrocaTurnoPorIdUseCase(solicitacaoRepository);
