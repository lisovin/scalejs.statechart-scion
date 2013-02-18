﻿/*global define,setTimeout,clearTimeout*/
define([
    'scalejs!core',
    './eventRaiser'
], function (
    core,
    eventRaiser
) {
    'use strict';

    var // imports
        has = core.object.has,
        get = core.object.get,
        array = core.array,
        log = core.log.debug,
        merge = core.object.merge,
        clone = core.object.clone;

    return function runtime(opts) {
        var datamodel = {},
            currentSmallStepSnapshot = {};

        function createActionContext(eventsToAddToInnerQueue) {
            function raiseEvent(event) {
                // if eventsToAddToInnerQueue is not defined it means raiseEvent is called
                // from transitionEvaluator. This is not allowed. 
                if (!has(eventsToAddToInnerQueue)) {
                    throw {
                        name: 'Illegal Operation',
                        message: 'Raising events is not allowed in transition conditions.'
                    };
                }
                array.addOne(eventsToAddToInnerQueue, event);
            }

            function inAny() {
                var states =  Array.prototype.slice.call(arguments, 0);
                return opts.getFullConfiguration().some(function (c) {
                    return states.some(function (s) { return s === c; });
                });
            }

            // The default context (e.g. `this`) is current small step snapshot (e.g. non-commited data).
            // If action needs access to big step data (e.g. commited data) it should do via bigstep property.
            return merge(currentSmallStepSnapshot, {
                bigstep: clone(datamodel),
                raise: eventRaiser(raiseEvent),
                inState: inAny
            });
        }

        function runAction(stateId, actionName, action, eventSet, eventsToAddToInnerQueue) {
            if (get(opts, 'printTrace')) {
                log('Running action ' + stateId + '.' + actionName);
            }

            var actionContext = createActionContext(eventsToAddToInnerQueue),
                result = action.call(actionContext, eventSet);

            delete actionContext.raise;
            delete actionContext.bigstep;

            currentSmallStepSnapshot = actionContext;
            //datamodel = actionContext;

            if (get(opts, 'printTrace')) {
                log('Finished action ' + stateId + '.' + actionName);
            }

            return result;
        }

        function transitionConditionEvaluator(eventSet) {
            var actionContext = createActionContext();

            return function (transition) {
                if (transition.condition) {
                    return transition.condition.call(actionContext, eventSet);
                }
            };
        }

        function beginSmallStep() {
            currentSmallStepSnapshot = clone(datamodel);
        }

        function endSmallStep() {
            datamodel = currentSmallStepSnapshot;
        }

        return {
            beginSmallStep: beginSmallStep,
            endSmallStep: endSmallStep,
            runAction: runAction,
            transitionConditionEvaluator: transitionConditionEvaluator
        };
    };
});

