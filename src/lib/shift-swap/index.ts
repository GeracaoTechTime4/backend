import {
  AprovarTrocaTurnoUseCase,
  CancelarTrocaTurnoUseCase,
  CriarFuncionarioUseCase,
  CriarSupervisorUseCase,
  CriarTurnoUseCase,
  ExpirarSolicitacoesTrocaTurnoUseCase,
  ListarFuncionariosUseCase,
  ListarSolicitacoesTrocaTurnoUseCase,
  ListarTurnosDisponiveisParaTrocaUseCase,
  ListarTurnosPorFuncionarioEDataUseCase,
  ListarTurnosUseCase,
  RejeitarTrocaTurnoUseCase,
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
export const criarTurno = new CriarTurnoUseCase(turnoRepository);

export const solicitarTrocaTurno = new SolicitarTrocaTurnoUseCase(turnoRepository, solicitacaoRepository);
export const aprovarTrocaTurno = new AprovarTrocaTurnoUseCase(
  supervisorRepository,
  funcionarioRepository,
  turnoRepository,
  solicitacaoRepository,
);
export const rejeitarTrocaTurno = new RejeitarTrocaTurnoUseCase(supervisorRepository, solicitacaoRepository);
export const cancelarTrocaTurno = new CancelarTrocaTurnoUseCase(solicitacaoRepository);
export const expirarSolicitacoesTrocaTurno = new ExpirarSolicitacoesTrocaTurnoUseCase(solicitacaoRepository);
export const listarSolicitacoesTrocaTurno = new ListarSolicitacoesTrocaTurnoUseCase(solicitacaoRepository);
export const listarTurnosDisponiveisParaTroca = new ListarTurnosDisponiveisParaTrocaUseCase(solicitacaoRepository);
