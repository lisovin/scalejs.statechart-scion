/*global define,describe,expect,it*/
/*jslint sloppy: true*/
/// <reference path="../Scripts/jasmine.js"/>
define([
    'scalejs!core',
    'scalejs!application'
], function (core) {
    var statechart = core.statechart.statechart;

    describe('statechart basic', function () {
        it('0', function () {
            var sc = statechart({
                initial: 'a',
                states: [{
                    id: 'a'
                }]
            });
            sc.start();

            expect(sc.getConfiguration()).toEqual(['a']);
        });

        it('1', function () {
            var sc = statechart({
                states: [{
                    id: 'initial1',
                    initial: true,
                    transitions: [{
                        target: 'a'
                    }]
                }, {
                    id: 'a',
                    transitions: [{
                        target: 'b',
                        event: 't'
                    }]
                }, {
                    id: 'b'
                }]
            });
            sc.start();

            expect(sc.getConfiguration()).toEqual(['a']);

            sc.raise('t');
            expect(sc.getConfiguration()).toEqual(['b']);
        });

        it('2', function () {
            var sc = statechart({
                states: [{
                    id: 'initial1',
                    initial: true,
                    transitions: [{
                        target: 'a'
                    }]
                }, {
                    id: 'a',
                    transitions: [{
                        target: 'b',
                        event: 't'
                    }]
                }, {
                    id: 'b',
                    transitions: [{
                        target: 'c',
                        event: 't2'
                    }]
                }, {
                    id: 'c'
                }]
            });
            sc.start();

            expect(sc.getConfiguration()).toEqual(['a']);

            sc.raise('t');
            expect(sc.getConfiguration()).toEqual(['b']);

            sc.raise('t2');
            expect(sc.getConfiguration()).toEqual(['c']);
        });
    });
});