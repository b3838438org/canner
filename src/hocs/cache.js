// @flow
import * as React from 'react';
import {mutate as defaultMutate, ActionManager as DefaultAciontManager} from '../action';
import type {Action, ActionType} from '../action/types';
import {isCompleteContain, genPaths} from './route';
import {fromJS} from 'immutable';

type Props = {
  request: Function,
  fetch: Function,
  reset: Function,
  deploy: Function,
  subscribe: Function,
  routes: Array<string>,
  params: Object,
  cacheActions: boolean,
  pattern: string,
  path: string
}

type State = {
  data: *
}

export default function withCache(Com: React.ComponentType<*>, options: {
  mutate: typeof defaultMutate,
  ActionManager: DefaultAciontManager
}) {
  const {mutate = defaultMutate, ActionManager = DefaultAciontManager} = options || {};
  return class ComWithCache extends React.Component<Props, State> {
    actionManager: ?ActionManager;
    subscribers: {
      [key: string]: Array<{id: string, callback: Function}>
    }
    subscribers = {};
    subscription: any
    constructor(props: Props) {
      super(props);
      const {routes, params, cacheActions, pattern, path} = this.props;
      if ((routes.length > 1 && isRoutesEndAtMe({routes, pattern, path})) ||
        params.op === 'create' ||
        cacheActions
      ) {
        this.actionManager = new ActionManager();
      }
      this.state = {
        data: fromJS({})
      };
    }

    addSubscriber = (key: string, id: string, callback: Function) => {
      const subscriber = {
        id,
        callback
      };
      if (this.subscribers[key]) {
        this.subscribers[key].push(subscriber);
      } else {
        this.subscribers[key] = [subscriber];
      }
    }

    unsubscribe = (key: string, subscriberId: string) => {
      this.subscribers[key] = this.subscribers[key].filter(subscriber => {
        return subscriber.id !== subscriberId;
      });
    }

    publish = (key: string, id?: string) => {
      // $FlowFixMe
      if (!this.actionManager) {
        return;
      }
      const {data} = this.state;
      const actions = this.actionManager.getActions(key, id);
      const mutatedData = actions.reduce((result, action) => {
        return mutate(result, action);
      }, data);
      (this.subscribers[key] || []).forEach(subscribe => {
        subscribe.callback(mutatedData);
      });
    }

    fetch = (key: string) => {
      // the data will be mutated by cached actions
      const {fetch} = this.props;
      if (!this.actionManager) {
        return fetch(key);
      }
      const actions = this.actionManager.getActions(key);
      return fetch(key).then(data => {
        this.setState({data});
        this._subscribe(key);
        return actions.reduce((result, action) => {
          return mutate(result, action);
        }, data);
      });
    }

    _subscribe = (key: string) => {
      const {subscribe} = this.props;
      this.subscription = subscribe(key, (data) => {
        this.setState({
          data
        }, () => this.publish(key));
      });
    }

    _unsubscribe = () => {
      if (this.subscription) {
        this.subscription.unsubscribe();
      }
    }

    request = (action: Action<ActionType>): Promise<*> => {
      // use action manager cache the actions
      // update state.actions
      const {request} = this.props;
      if (!this.actionManager) {
        return request(action);
      }
      this.actionManager.addAction(action);
      const {key, id} = action.payload;
      this.publish(key, id);
      return Promise.resolve();
    }

    deploy = (key: string, id?: string): Promise<*> => {
      // request cached actions
      const {request, deploy} = this.props;
      if (!this.actionManager) {
        return deploy(key, id);
      }
      const actions = this.actionManager.getActions(key, id);
      // $FlowFixMe
      this.actionManager.removeActions(key, id);
      actions.forEach(action => {
        request(action);
      });
      return Promise.resolve();
    }

    reset = (key: string, id?: string): Promise<*> => {
      // remove sepicfic cached actions in actionManager
      const {reset} = this.props;
      if (!this.actionManager) {
        return reset(key, id);
      }
      this.actionManager.removeActions(key, id);
      this.publish(key, id);
      return Promise.resolve();
    }

    subscribe = (key: string, callback: Function) => {
      const {subscribe} = this.props;
      if (!this.actionManager) {
        return subscribe(key, callback);
      }
      const id = genSubscriberId();
      this.addSubscriber(key, id, callback);
      return {
        unsubscribe: () => {
          this.unsubscribe(key, id);
        }
      }
    }
    
    render() {
      return (
        <Com
          {...this.props}
          fetch={this.fetch}
          request={this.request}
          deploy={this.deploy}
          reset={this.reset}
          subscribe={this.subscribe}
        />
      );
    }
  }
}

export function isRoutesEndAtMe({
  routes,
  path,
  pattern
}: {
  routes: Array<string>,
  path: string,
  pattern: string
}): boolean {
  const paths = genPaths(path, pattern);
  return (paths.length === routes.length && isCompleteContain(paths, routes));
}

export function genSubscriberId() {
  return Math.random().toString(36).substr(2, 7);
}