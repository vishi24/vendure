/* eslint-disable no-console */
import { HttpService } from '@nestjs/axios';
import { Injectable, Inject, Req, Res } from '@nestjs/common';
import { RequestContext, Logger } from '@vendure/core';
import { IncomingHttpHeaders } from 'http';
import { lastValueFrom, map } from 'rxjs';

import { axiosErrorHandler } from './common';
import { BECKN_VENDURE_PLUGIN_OPTIONS, loggerCtx } from './constants';
import { TransformerService } from './transformer/transformer.service';
import { BecknRespose } from './transformer/types';
import { BecknVendurePluginOptions, Environment } from './types';

@Injectable()
export class GenericHandlerService {
    constructor(
        @Inject(BECKN_VENDURE_PLUGIN_OPTIONS) private options: BecknVendurePluginOptions,
        @Inject(TransformerService) private transformer: TransformerService,
    ) {}

    async handleEvent(ctx: RequestContext) {
        if (!ctx.req?.body || !ctx.req.headers) throw Error('Request Context is empty');

        const env: Environment = this._get_environment(ctx);
        const beckn_request = {
            headers: this._get_simplified_string_headers(ctx.req.headers),
            body: ctx.req.body,
        };

        const beckn_response = await this.transformer.transform(env, beckn_request);
        if (!beckn_response) throw Error('Could not generate Beckn Response packet');

        const beckn_response_ack = await this._send_response_to_beckn(env, beckn_response);
        if (!beckn_response_ack) throw Error('Could not send response back to Beckn network');
    }

    async _send_response_to_beckn(env: { [key: string]: string }, beckn_response: BecknRespose) {
        // console.log(JSON.stringify(beckn_response, null, 2));
        const bpp_ps_url = `${this.options.bpp_protocol_server_base_url}/${env.response_endpoint}`;
        try {
            const httpService = new HttpService();
            const response = await lastValueFrom(
                httpService
                    .post(bpp_ps_url, JSON.stringify(beckn_response.body), {
                        headers: beckn_response.headers,
                    })
                    .pipe(map(resp => resp.data)),
            );
            return response;
        } catch (err: any) {
            Logger.info(axiosErrorHandler(err).message, loggerCtx);
        }
    }

    _get_simplified_string_headers(headers: IncomingHttpHeaders) {
        return Object.entries(headers)
            .map(([k, v]) => [k.toString(), v ? v.toString() : ''])
            .reduce((acc: any, [k, v]) => {
                acc[k] = v;
                return acc;
            }, {});
    }

    _get_environment(ctx: RequestContext): Environment {
        if (!ctx.req || !ctx.req.body || !ctx.req.headers) return {};
        return {
            host_url: `${ctx.req.protocol || ''}://${ctx.req.headers.host || ''}`,
            bpp_id: this.options.bpp_id,
            bpp_uri: this.options.bpp_uri,
            country: this.options.bpp_country,
            city: this.options.bpp_city,
            request_endpoint: ctx.req.body.context.action as string,
            response_endpoint: `on_${ctx.req.body.context.action as string}`,
        };
    }
}
