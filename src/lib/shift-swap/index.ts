import {
  CriarFuncionarioUseCase,
  CriarSupervisorUseCase,
  CriarTurnoUseCase,
  ListarFuncionariosUseCase,
  ListarTurnosPorFuncionarioEDataUseCase,
  ListarTurnosUseCase,
} from "shift-swap";
import { pool } from "../db";
import { PgFuncionarioRepository } from "./funcionario.repository";
import { PgSupervisorRepository } from "./supervisor.repository";
import { PgTurnoRepository } from "./turno.repository";

const funcionarioRepository = new PgFuncionarioRepository(pool);
const supervisorRepository = new PgSupervisorRepository(pool);
const turnoRepository = new PgTurnoRepository(pool);

export const criarFuncionario = new CriarFuncionarioUseCase(funcionarioRepository);
export const criarSupervisor = new CriarSupervisorUseCase(supervisorRepository);
export const listarFuncionarios = new ListarFuncionariosUseCase(funcionarioRepository);
export const listarTurnos = new ListarTurnosUseCase(turnoRepository);
export const listarTurnosPorFuncionarioEData = new ListarTurnosPorFuncionarioEDataUseCase(turnoRepository);
export const criarTurno = new CriarTurnoUseCase(turnoRepository);
