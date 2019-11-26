/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Event, Emitter } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ExtensionsRegistry, IExtensionPointUser } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { URI } from 'vs/base/common/uri';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';

export const IRemoteExplorerService = createDecorator<IRemoteExplorerService>('remoteExplorerService');
export const REMOTE_EXPLORER_TYPE_KEY: string = 'remote.explorerType';


export interface Tunnel {
	remote: string;
	host: URI;
	local?: string;
	name?: string;
	description?: string;
	closeable?: boolean;
}

export class TunnelModel {
	forwarded: Map<string, Tunnel>;
	published: Map<string, Tunnel>;
	candidates: Map<string, Tunnel>;
	private _onForwardPort: Emitter<Tunnel> = new Emitter();
	public onForwardPort: Event<Tunnel> = this._onForwardPort.event;
	private _onClosePort: Emitter<string> = new Emitter();
	public onClosePort: Event<string> = this._onClosePort.event;
	private _onPortName: Emitter<string> = new Emitter();
	public onPortName: Event<string> = this._onPortName.event;
	constructor(
		@ITunnelService private readonly tunnelService: ITunnelService
	) {
		this.forwarded = new Map();
		this.forwarded.set('3000',
			{
				description: 'one description',
				local: '3000',
				remote: '3000',
				closeable: true,
				host: URI.parse('http://fakeHost')
			});
		this.forwarded.set('4000',
			{
				local: '4001',
				remote: '4000',
				name: 'Process Port',
				closeable: true,
				host: URI.parse('http://fakeHost')
			});

		this.published = new Map();
		this.published.set('3500',
			{
				description: 'one description',
				local: '3500',
				remote: '3500',
				name: 'My App',
				host: URI.parse('http://fakeHost')
			});
		this.published.set('4500',
			{
				description: 'two description',
				local: '4501',
				remote: '4500',
				host: URI.parse('http://fakeHost')
			});
		this.candidates = new Map();
		this.candidates.set('5000',
			{
				description: 'node.js /anArg',
				remote: '5000',
				host: URI.parse('http://fakeHost')
			});
		this.candidates.set('5500',
			{
				remote: '5500',
				host: URI.parse('http://fakeHost')
			});
	}

	forward(remote: string, host?: URI, local?: string, name?: string) {
		if (!host) {
			host = URI.parse('http://fakeHost');
		}
		if (!this.forwarded.has(remote)) {
			const newForward: Tunnel = {
				remote: remote,
				local: local ?? remote,
				name: name,
				closeable: true,
				host
			};
			this.forwarded.set(remote, newForward);
			this._onForwardPort.fire(newForward);
		}
	}

	name(remote: string, name: string) {
		if (this.forwarded.has(remote)) {
			this.forwarded.get(remote)!.name = name;
			this._onPortName.fire(remote);
		}
	}

	close(remote: string) {
		if (this.forwarded.has(remote)) {
			this.forwarded.delete(remote);
			this._onClosePort.fire(remote);
		}
	}

	address(remote: string): URI | undefined {
		let tunnel: Tunnel | undefined = undefined;
		if (this.forwarded.has(remote)) {
			tunnel = this.forwarded.get(remote)!;
		} else if (this.published.has(remote)) {
			tunnel = this.published.get(remote)!;
		}
		if (tunnel) {
			return URI.parse('http://localhost:' + tunnel.local);
		}
		return undefined;
	}
}

export interface IRemoteExplorerService {
	_serviceBrand: undefined;
	onDidChangeTargetType: Event<string>;
	targetType: string;
	readonly helpInformation: HelpInformation[];
	readonly tunnelModel: TunnelModel;
}

export interface HelpInformation {
	extensionDescription: IExtensionDescription;
	getStarted?: string;
	documentation?: string;
	feedback?: string;
	issues?: string;
}

const remoteHelpExtPoint = ExtensionsRegistry.registerExtensionPoint<HelpInformation>({
	extensionPoint: 'remoteHelp',
	jsonSchema: {
		description: nls.localize('RemoteHelpInformationExtPoint', 'Contributes help information for Remote'),
		type: 'object',
		properties: {
			'getStarted': {
				description: nls.localize('RemoteHelpInformationExtPoint.getStarted', "The url to your project's Getting Started page"),
				type: 'string'
			},
			'documentation': {
				description: nls.localize('RemoteHelpInformationExtPoint.documentation', "The url to your project's documentation page"),
				type: 'string'
			},
			'feedback': {
				description: nls.localize('RemoteHelpInformationExtPoint.feedback', "The url to your project's feedback reporter"),
				type: 'string'
			},
			'issues': {
				description: nls.localize('RemoteHelpInformationExtPoint.issues', "The url to your project's issues list"),
				type: 'string'
			}
		}
	}
});

class RemoteExplorerService implements IRemoteExplorerService {
	public _serviceBrand: undefined;
	private _targetType: string = '';
	private _onDidChangeTargetType: Emitter<string> = new Emitter<string>();
	public onDidChangeTargetType: Event<string> = this._onDidChangeTargetType.event;
	private _helpInformation: HelpInformation[] = [];
	private _tunnelModel: TunnelModel;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ITunnelService tunnelService: ITunnelService) {
		this._tunnelModel = new TunnelModel(tunnelService);
		remoteHelpExtPoint.setHandler((extensions) => {
			let helpInformation: HelpInformation[] = [];
			for (let extension of extensions) {
				this._handleRemoteInfoExtensionPoint(extension, helpInformation);
			}

			this._helpInformation = helpInformation;
		});
	}

	set targetType(name: string) {
		if (this._targetType !== name) {
			this._targetType = name;
			this.storageService.store(REMOTE_EXPLORER_TYPE_KEY, this._targetType, StorageScope.WORKSPACE);
			this.storageService.store(REMOTE_EXPLORER_TYPE_KEY, this._targetType, StorageScope.GLOBAL);
			this._onDidChangeTargetType.fire(this._targetType);
		}
	}
	get targetType(): string {
		return this._targetType;
	}

	private _handleRemoteInfoExtensionPoint(extension: IExtensionPointUser<HelpInformation>, helpInformation: HelpInformation[]) {
		if (!extension.description.enableProposedApi) {
			return;
		}

		if (!extension.value.documentation && !extension.value.feedback && !extension.value.getStarted && !extension.value.issues) {
			return;
		}

		helpInformation.push({
			extensionDescription: extension.description,
			getStarted: extension.value.getStarted,
			documentation: extension.value.documentation,
			feedback: extension.value.feedback,
			issues: extension.value.issues
		});
	}

	get helpInformation(): HelpInformation[] {
		return this._helpInformation;
	}

	get tunnelModel(): TunnelModel {
		return this._tunnelModel;
	}
}

registerSingleton(IRemoteExplorerService, RemoteExplorerService, true);
