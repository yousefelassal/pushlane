import {
	createParamDecorator,
	type ExecutionContext,
	Inject,
	Injectable,
	UnauthorizedException,
	type CanActivate,
} from '@nestjs/common';
import type { Request } from 'express';
import { Projects, type Project } from '../../../libs/core/src/projects.js';

interface ProjectRequest extends Request {
	project?: Project;
}

/** Extracts one bearer credential without accepting credentials in URLs. */
export function bearerToken(value: string | undefined): string {
	const token = /^Bearer ([A-Za-z0-9_-]{20,256})$/.exec(value ?? '')?.[1];

	if (!token) throw new UnauthorizedException('A bearer token is required.');

	return token;
}

/** Backend API keys grant access only to their project environment. */
@Injectable()
export class ProjectGuard implements CanActivate {
	constructor(@Inject(Projects) private readonly projects: Projects) {}

	async canActivate(context: ExecutionContext): Promise<boolean> {
		const request = context.switchToHttp().getRequest<ProjectRequest>();

		request.project = await this.projects.authenticate(
			bearerToken(request.headers.authorization),
		);

		return true;
	}
}

/** Reads the project authenticated by ProjectGuard. */
export const CurrentProject = createParamDecorator(
	(_data: unknown, context: ExecutionContext): Project => {
		const project = context.switchToHttp().getRequest<ProjectRequest>().project;

		if (!project)
			throw new UnauthorizedException('Project authentication is required.');

		return project;
	},
);
