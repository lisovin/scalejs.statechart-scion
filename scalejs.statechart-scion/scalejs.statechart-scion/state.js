/*global define*/
/*jslint nomen:true*/
define([
    'scalejs!core',
    './state.builder',
    'scion'
], function (
    core,
    builder,
    scion
) {
    'use strict';

    var // imports
        enumerable = core.linq.enumerable,
        toArray = core.array.toArray,
        removeOne = core.array.removeOne,
        has = core.object.has,
        is = core.type.is,
        curry = core.functional.curry,
        state = builder.state,
        parallel = builder.parallel,
        // members
        applicationStatechartSpec,
        applicationStatechart;

    function allStates(current) {
        if (has(current, 'states')) {
            return enumerable
                .make(current)
                .concat(enumerable
                    .from(current.states)
                    .selectMany(allStates));
        }

        return enumerable.make(current);
    }

    function findState(root, stateId) {
        var found = allStates(root).firstOrDefault(function (s) { return s.id === stateId; });

        return found;
    }

    function findStateParent(root, stateId) {
        var found = allStates(root).firstOrDefault(function (s) {
            return s.states && s.states.some(function (s) { return s.id === stateId; });
        });

        return found;
    }


    function registerState() {
        return curry(function (parentStateId, stateBuilder) {
            var state = stateBuilder.toSpec(),
                parent,
                existing;

            parent = findState(applicationStatechartSpec, parentStateId);
            if (!parent) {
                throw new Error('Parent state "' + parentStateId + '" doesn\'t exist');
            }

            if (has(state, 'id')) {
                existing = findState(applicationStatechartSpec, state.id);
                if (existing) {
                    throw new Error('State "' + state.id + '" already exists.');
                }
            }

            if (!has(parent, 'states')) {
                parent.states = [];
            }
            parent.states.push(state);
        }).apply(null, arguments);
    }

    function registerStates(parentStateId) {
        if (core.isApplicationRunning()) {
            throw new Error('Can\'t register a state while application is running.');
        }

        toArray(arguments, 1).forEach(registerState(parentStateId));
    }

    function unregisterStates() {
        if (core.isApplicationRunning()) {
            throw new Error('Can\'t unregister a state while application is running.');
        }

        toArray(arguments).forEach(function (stateId) {
            var parent = findStateParent(applicationStatechartSpec, stateId),
                state = enumerable.from(parent.states).first(function (s) { return s.id === stateId; });
            removeOne(parent.states, state);
        });
    }

    function raise(eventOrName, eventDataOrDelay, delay) {
        var e;
        if (is(eventOrName, 'string')) {
            e = {name: eventOrName};
        } else {
            if (!is(eventOrName, 'name')) {
                throw new Error('event object should have `name` property.');
            }
            e = eventOrName;
        }

        if (!has(delay) && is(eventDataOrDelay, 'number')) {
            delay = eventDataOrDelay;
        } else {
            e.data = eventDataOrDelay;
        }

        applicationStatechart.send(e, {delay: delay});
    }

    applicationStatechartSpec = state('scalejs-app', parallel('root')).toSpec();

    core.onApplicationEvent(function (event) {
        switch (event) {
        case 'started':
            applicationStatechart = new scion.Statechart(applicationStatechartSpec, {
                logStatesEnteredAndExited: false
            });
            applicationStatechart.start();
            break;
        case 'stopped':
            break;
        }
    });

    return {
        registerStates: registerStates,
        unregisterStates: unregisterStates,
        raise: raise,
        builder: builder
    };
});

