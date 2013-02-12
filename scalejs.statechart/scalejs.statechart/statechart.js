﻿/*global define,setTimeout,clearTimeout*/
define([
    'scalejs!core',
    './model',
    './factory',
    './runtime',
    './stateKinds',
    './transitionSelector',
    './eventRaiser'
], function (
    core,
    model,
    stateChartFactory,
    stateChartRuntime,
    stateKinds,
    stateChartTransitionSelector,
    eventRaiser
) {
    'use strict';

    var // imports
        log = core.log.debug,
        array = core.array,
        enumerable = core.linq.enumerable;

    return function statechart() {
        var factory,
            runtime,
            transitionSelector,
            configuration = [],
            historyValue,
            innerEventQueue = [],
            isInFinalState = false,
            listeners = [],
            printTrace = true,
            logStatesEnteredAndExited = false,
            isStepping = false,
            root;

        function conflicts(t1, t2) {
            return !model.isArenaOrthogonal(t1, t2);
        }

        function getInconsistentTransitions(transitions) {
            var allInconsistentTransitions = [],
                inconsistentTransitionsPairs = [],
                i,
                j,
                t1,
                t2,
                consistentTransitions;
                //transitionList = enumerable.from(transitions);

            for (i = 0; i < transitions.length; i += 1) {
                for (j = i + 1; j < transitions.length; j += 1) {
                    t1 = transitions[i];
                    t2 = transitions[j];
                    if (conflicts(t1, t2)) {
                        array.addOne(allInconsistentTransitions, t1);
                        array.addOne(allInconsistentTransitions, t2);
                        array.addOne(inconsistentTransitionsPairs, [t1, t2]);
                    }
                }
            }

            consistentTransitions = enumerable.from(transitions).except(allInconsistentTransitions).toArray();
            return [consistentTransitions, inconsistentTransitionsPairs];
        }

        function selectPriorityEnabledTransitions(enabledTransitions) {
            var priorityEnabledTransitions = [],
                tuple = getInconsistentTransitions(enabledTransitions),
                consistentTransitions = tuple[0],
                inconsistentTransitionsPairs = tuple[1];

            priorityEnabledTransitions = array.copy(consistentTransitions);

            while (inconsistentTransitionsPairs.length > 0) {
                enabledTransitions = enumerable
                    .from(inconsistentTransitionsPairs)
                    .select(model.getTransitionWithHigherSourceChildPriority)
                    .distinct()
                    .toArray();

                tuple = getInconsistentTransitions(enabledTransitions);
                consistentTransitions = tuple[0];
                inconsistentTransitionsPairs = tuple[1];

                priorityEnabledTransitions = enumerable
                    .from(priorityEnabledTransitions)
                    .union(consistentTransitions)
                    .toArray();
            }

            return priorityEnabledTransitions;
        }

        function selectTransitions(eventSet) {
            var states,
                eventNames,
                enabledTransitions,
                transitionConditionEvaluator,
                priorityEnabledTransitions;

            states = enumerable.from(configuration)
                .selectMany(function (s) {
                    return model.getAncestorsOrSelf(s);
                })
                .distinct()
                .toArray();

            transitionConditionEvaluator = runtime.transitionConditionEvaluator(eventSet);
            eventNames = enumerable.from(eventSet).select('$.name').toArray();

            enabledTransitions = enumerable.from(states)
                .selectMany(function (state) {
                    return transitionSelector(state, eventNames, transitionConditionEvaluator);
                })
                .distinct()
                .toArray();

            priorityEnabledTransitions = selectPriorityEnabledTransitions(enabledTransitions);

            return priorityEnabledTransitions;
        }

        function getStatesExited(transitions) {
            var statesExited = [],
                basicStatesExited = [],
                sortedStatesExited = [];

            array.iter(transitions, function (transition) {
                var lca = transition.lca,
                    desc = lca.descendants;

                array.iter(configuration, function (state) {
                    if (desc.indexOf(state) > -1) {
                        array.addOne(basicStatesExited, state);
                        array.addOne(statesExited, state);
                        array.iter(model.getAncestors(state, lca), function (anc) {
                            array.addOne(statesExited, anc);
                        });
                    }
                });
            });

            sortedStatesExited = enumerable
                .from(statesExited)
                .orderBy('$.depth')
                .toArray();

            return [basicStatesExited, sortedStatesExited];
        }

        function getStatesEntered(transitions) {
            var statesToEnter = [],
                basicStatesToEnter = [],
                statesProcessed  = [],
                statesToProcess = [],
                processState,
                processTransitionSourceAndTarget,
                s,
                sortedStatesEntered;

            processTransitionSourceAndTarget = function (source, target) {
                //process each target
                processState(target);

                //and process ancestors of targets up to LCA, but according to special rules
                var lca = model.getLCA(source, target),
                    ancestors = model.getAncestors(target, lca);

                array.iter(ancestors, function (s) {
                    if (s.kind === stateKinds.COMPOSITE) {
                        //just add him to statesToEnter, and declare him processed
                        //this is to prevent adding his initial state later on
                        array.addOne(statesToEnter, s);

                        array.addOne(statesProcessed, s);
                    } else {
                        //everything else can just be passed through as normal
                        processState(s);
                    }
                });
            };

            processState = function (s) {
                if (array.indexOf(statesProcessed, s) > -1) {
                    return;
                }

                if (s.kind === stateKinds.HISTORY) {
                    if (historyValue.hasOwnProperty(s.id)) {
                        historyValue[s.id].forEach(function (stateFromHistory) {
                            processTransitionSourceAndTarget(s, stateFromHistory);
                        });
                    } else {
                        array.addOne(statesToEnter, s);
                        array.addOne(basicStatesToEnter, s);
                    }
                } else {
                    array.addOne(statesToEnter, s);

                    if (s.kind === stateKinds.PARALLEL) {
                        statesToProcess.push.apply(statesToProcess,
                            s.children.filter(function (s) {
                                return s.kind !== stateKinds.HISTORY;
                            }));
                    } else if (s.kind === stateKinds.COMPOSITE) {
                        statesToProcess.push(s.initial);
                    } else if (s.kind === stateKinds.INITIAL || s.kind === stateKinds.BASIC || s.kind === stateKinds.FINAL) {
                        array.addOne(basicStatesToEnter, s);
                    }
                }

                array.addOne(statesProcessed, s);
            };

            //do the initial setup
            array.iter(transitions, function (transition) {
                array.iter(transition.targets, function (target) {
                    processTransitionSourceAndTarget(transition.source, target);
                });
            });

            //loop and add states until there are no more to add (we reach a stable state)
            while ((s = statesToProcess.pop()) !== undefined) {
                processState(s);
            }

            //sort based on depth
            sortedStatesEntered = enumerable.from(statesToEnter).orderBy('$.depth').toArray();

            return [basicStatesToEnter, sortedStatesEntered];
        }

        function performSmallStep(eventSet) {
            var selectedTransitions,
                selectedTransitionsWithTargets,
                exitedTuple,
                basicStatesExited,
                statesExited,
                enteredTuple,
                basicStatesEntered,
                statesEntered,
                eventsToAddToInnerQueue,
                sortedTransitions;

            runtime.beginSmallStep();

            if (printTrace) {
                log("selecting transitions with eventSet: ", eventSet);
            }

            selectedTransitions = selectTransitions(eventSet);

            if (selectedTransitions.length > 0) {
                if (printTrace) {
                    log("sorted transitions: ", selectedTransitions);
                }

                //we only want to enter and exit states from transitions with targets
                //filter out targetless transitions here - we will only use these to execute transition actions
                selectedTransitionsWithTargets = enumerable
                    .from(selectedTransitions)
                    .where('$.targets')
                    .toArray();

                exitedTuple = getStatesExited(selectedTransitionsWithTargets);
                basicStatesExited = exitedTuple[0];
                statesExited = exitedTuple[1];

                enteredTuple = getStatesEntered(selectedTransitionsWithTargets);
                basicStatesEntered = enteredTuple[0];
                statesEntered = enteredTuple[1];

                if (printTrace) {
                    log("basicStatesExited ", basicStatesExited);
                    log("basicStatesEntered ", basicStatesEntered);
                    log("statesExited ", statesExited);
                    log("statesEntered ", statesEntered);
                }

                eventsToAddToInnerQueue = [];

                //update history states
                if (printTrace) {
                    log("executing state exit actions");
                }

                array.iter(statesExited, function (state) {
                    if (printTrace || logStatesEnteredAndExited) {
                        log("exiting ", state.id);
                    }

                    //invoke listeners
                    array.iter(listeners, function (l) {
                        if (l.onExit) {
                            l.onExit(state.id);
                        }
                    });

                    if (state.onExit !== undefined) {
                        runtime.runAction(state.onExit, eventSet, eventsToAddToInnerQueue);
                    }

                    var f;
                    if (state.history) {
                        if (state.history.isDeep) {
                            f = function (s0) {
                                return s0.kind === stateKinds.BASIC && state.descendants.indexOf(s0) > -1;
                            };
                        } else {
                            f = function (s0) {
                                return s0.parent === state;
                            };
                        }
                        //update history
                        historyValue[state.history.id] = statesExited.filter(f);
                    }
                });


                // -> Concurrency: Number of transitions: Multiple
                // -> Concurrency: Order of transitions: Explicitly defined
                sortedTransitions = enumerable.from(selectedTransitions).orderBy('$.documentOrder').toArray();

                if (printTrace) {
                    log("executing transitition actions");
                }


                array.iter(sortedTransitions, function (transition) {
                    var targetIds = enumerable.from(transition.targets).select('$.id').toArray();

                    array.iter(listeners, function (l) {
                        if (l.onTransition) {
                            l.onTransition(transition.source.id, targetIds);
                        }
                    });

                    if (transition.action) {
                        runtime.runAction(transition.action, eventSet, eventsToAddToInnerQueue);
                    }
                });

                if (printTrace) {
                    log("executing state enter actions");
                }

                array.iter(statesEntered, function (state) {
                    if (printTrace || this.opts.logStatesEnteredAndExited) {
                        log("entering", state.id);
                    }

                    array.iter(listeners, function (l) {
                        if (l.onEntry) {
                            l.onEntry(state.id);
                        }
                    });

                    if (state.onEntry) {
                        runtime.runAction(state.onEntry, eventSet, eventsToAddToInnerQueue);
                    }
                });

                if (printTrace) {
                    log("updating configuration ");
                    log("old configuration ", configuration);
                }

                //update configuration by removing basic states exited, and adding basic states entered
                configuration = enumerable
                    .from(configuration)
                    .except(basicStatesExited)
                    .union(basicStatesEntered)
                    .toArray();

                if (printTrace) {
                    log("new configuration ", configuration);
                }

                //add set of generated events to the innerEventQueue -> Event Lifelines: Next small-step
                if (eventsToAddToInnerQueue.length > 0) {
                    if (printTrace) {
                        log("adding triggered events to inner queue ", eventsToAddToInnerQueue);
                    }
                    innerEventQueue.push(eventsToAddToInnerQueue);
                }

                if (printTrace) {
                    log("updating datamodel for next small step :");
                }
            }

            runtime.endSmallStep();
            // if selectedTransitions is empty, we have reached a stable state, 
            // and the big-step will stop, otherwise will continue -> Maximality: Take-Many
            return selectedTransitions;
        }

        function performBigStep(e) {
            if (e) {
                innerEventQueue.push([e]);
            }

            var keepGoing = true,
                eventSet,
                selectedTransitions;

            while (keepGoing) {
                eventSet = innerEventQueue.length > 0 ? innerEventQueue.shift() : [];

                selectedTransitions = performSmallStep(eventSet);
                keepGoing = enumerable.from(selectedTransitions).any();
            }

            isInFinalState = enumerable.from(configuration).all(function (s) {
                return s.kind === stateKinds.FINAL;
            });
        }

        function getConfiguration() {
            var configurationIds = enumerable.from(configuration)
                .orderBy('$.documentOrder')
                .select('$.id')
                .toArray();

            return configurationIds;
        }

        function getFullConfiguration() {
            var configurationIds = enumerable
                .from(configuration)
                .selectMany(function (s) {
                    return model.getAncestorsOrSelf(s);
                })
                .select('$.id')
                .orderBy('$.documentOrder')
                .distinct()
                .toArray();

            return configurationIds;
        }

        function raiseEvent(event) {
            if (isStepping) {
                throw new Error('`raiseEvent` called before previous call to `raiseEvent` could complete. ' +
                                'If executed in single-threaded environment, this means it was called recursively,' +
                                'which is illegal, as it would break SCION step semantics.');
            }

            isStepping = true;
            performBigStep(event);
            isStepping = false;
        }

        function start() {
            //perform big step without events to take all default transitions and reach stable initial state
            if (printTrace) {
                log("performing initial big step");
            }

            performBigStep();

            return getConfiguration();
        }

        function getSpecification() {
            return factory.getSpec();
        }

        // initialize all parts
        transitionSelector = stateChartTransitionSelector();

        factory = stateChartFactory();
        root = factory.create.apply(null, arguments);

        configuration.push(root.initial || root);
        runtime = stateChartRuntime();

        return {
            factory: factory,
            start: start,
            raise: eventRaiser(raiseEvent),
            getConfiguration: getConfiguration,
            getFullConfiguration: getFullConfiguration,
            getSpecification: getSpecification
        };
    };
});

